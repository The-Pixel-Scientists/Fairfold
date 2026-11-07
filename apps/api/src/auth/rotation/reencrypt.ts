// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Secret re-encryption (ADR 0010, "Secrets at rest"), as app_auth. Each
// TOTP secret and SSO secret on another configured key version is opened
// with that version and sealed again with the current one (the version
// TPS_AUTH_SECRET_CURRENT names), one row per short
// transaction, under a row lock and only if the row is still on the old
// version, so a concurrent save or enrolment is never overwritten and a
// second run changes nothing. Backup codes are HMACs and cannot be re-keyed:
// users whose set uses an older version are asked by email to make a new
// one. One secrets_re_encrypted event records the counts, also when the run
// stops part-way. No secret, ciphertext, key or id reaches the output, a
// log line or the event.

import { withTenant, type Kysely, type Transaction } from '@pixel-scientists/db';
import { symmetricDecrypt, symmetricEncrypt, type SecretConfig } from 'better-auth/crypto';
import type { FastifyBaseLogger } from 'fastify';

import { ssoProvidersByKeyVersion } from '../../../../../packages/db/src/sso-functions.ts';

import type { Sender } from '../../email/sender.ts';
import type { AuthSecrets } from '../settings.ts';
import { openSecret, sealSecret, ssoSecretKeys, type SsoSecretKeys } from '../sso/secrets.ts';

type Tables = {
  'auth.user': { id: string; email: string };
  'auth.two_factor': { id: string; user_id: string; secret: string; backup_codes: string | null };
  'auth.sso_provider': {
    id: string;
    key_version: number | null;
    client_secret: Buffer | null;
    sp_private_key: Buffer | null;
  };
  'auth.audit_event': {
    request_id: string;
    code: 'secrets_re_encrypted';
    reason: 'incomplete' | null;
    key_version: number;
    totp_count: number;
    sso_count: number;
    backup_notice_count: number;
  };
};

const BATCH = 100;
const FIRST_ID = '00000000-0000-0000-0000-000000000000';

export interface RotationKeys {
  readonly current: number;
  /** The other versions, oldest first: everything they sealed moves to `current`. */
  readonly older: readonly number[];
  /** Better Auth's versioned secrets. A value with no version is version 1's. */
  readonly totp: SecretConfig;
  readonly sso: SsoSecretKeys;
}

/** The keys for the auth secret's versions, as the API uses them. */
export function rotationKeys(secrets: AuthSecrets): RotationKeys {
  const { current, versions } = secrets;
  const legacy = versions.get(1);
  return {
    current,
    older: [...versions.keys()].filter((version) => version !== current).sort((a, b) => a - b),
    totp: {
      keys: new Map([...versions].map(([version, secret]) => [version, secret.reveal()])),
      currentVersion: current,
      ...(legacy === undefined ? {} : { legacySecret: legacy.reveal() }),
    },
    sso: ssoSecretKeys(secrets),
  };
}

export interface Counts {
  totp: number;
  sso: number;
  /** Users whose backup codes use an older version, and how many were sent the notice. */
  backupFound: number;
  backupNotices: number;
}

export interface RotationDependencies {
  /** As app_auth. */
  readonly auth: Kysely<unknown>;
  readonly keys: RotationKeys;
  readonly sender: Sender;
  readonly log: FastifyBaseLogger;
  readonly requestId: string;
}

const tables = (db: Kysely<unknown> | Transaction<unknown>) => db.$extendTables<Tables>();

/** Which TOTP secrets one older version sealed: a LIKE test on the stored value. */
interface TotpSource {
  readonly op: 'like' | 'not like';
  readonly pattern: string;
}

/** The ids of `source`'s TOTP rows, in order, BATCH at a time. */
async function* totpIds(db: Kysely<unknown>, { op, pattern }: TotpSource) {
  for (let after = FIRST_ID; ;) {
    const rows = await tables(db)
      .selectFrom('auth.two_factor')
      .select('id')
      .where('secret', op, pattern)
      .where('id', '>', after)
      .orderBy('id')
      .limit(BATCH)
      .execute();
    for (const { id } of rows) yield id;
    const last = rows.at(-1);
    if (last === undefined || rows.length < BATCH) return;
    after = last.id;
  }
}

async function reencryptTotp(deps: RotationDependencies, counts: Counts): Promise<void> {
  const { totp } = deps.keys;
  const sources: TotpSource[] = deps.keys.older.map((version) => ({
    op: 'like',
    pattern: `$ba$${String(version)}$%`,
  }));
  // Better Auth stores a value sealed with a single secret without a version.
  if (totp.legacySecret !== undefined) sources.push({ op: 'not like', pattern: '$ba$%' });
  for (const source of sources) {
    for await (const id of totpIds(deps.auth, source)) {
      const done = await deps.auth.transaction().execute(async (trx) => {
        const row = await tables(trx)
          .selectFrom('auth.two_factor')
          .select('secret')
          .where('id', '=', id)
          .where('secret', source.op, source.pattern)
          .forUpdate()
          .executeTakeFirst();
        if (row === undefined) return false;
        const plain = await symmetricDecrypt({ key: totp, data: row.secret });
        const secret = await symmetricEncrypt({ key: totp, data: plain });
        await tables(trx)
          .updateTable('auth.two_factor')
          .set({ secret })
          .where('id', '=', id)
          .execute();
        return true;
      });
      if (done) counts.totp += 1;
    }
  }
}

async function reencryptSso(deps: RotationDependencies, counts: Counts): Promise<void> {
  const { sso } = deps.keys;
  for (const version of deps.keys.older) {
    for (const { id, tenant } of await ssoProvidersByKeyVersion(deps.auth, version)) {
      const done = await withTenant(deps.auth, tenant, async (trx) => {
        const row = await tables(trx)
          .selectFrom('auth.sso_provider')
          .select(['client_secret', 'sp_private_key'])
          .where('id', '=', id)
          .where('key_version', '=', version)
          .forUpdate()
          .executeTakeFirst();
        if (row === undefined) return false;
        const reseal = (column: 'client_secret' | 'sp_private_key') => {
          const sealed = row[column];
          if (sealed === null) return null;
          const place = { column, providerId: id, tenantId: tenant };
          return sealSecret(sso, place, openSecret(sso, place, sealed, version)).sealed;
        };
        await tables(trx)
          .updateTable('auth.sso_provider')
          .set({
            client_secret: reseal('client_secret'),
            sp_private_key: reseal('sp_private_key'),
            key_version: sso.current,
          })
          .where('id', '=', id)
          .execute();
        return true;
      });
      if (done) counts.sso += 1;
    }
  }
}

const NOTICE = {
  subject: 'Generate new backup codes',
  text: [
    'Your backup codes for signing in will soon stop working.',
    '',
    'Sign in, go to your security settings and generate a new set of backup codes.',
    'Your authenticator app and passkeys keep working as before.',
  ].join('\n'),
};

async function askForNewBackupCodes(deps: RotationDependencies, counts: Counts): Promise<void> {
  for (const version of deps.keys.older) {
    for (let after = FIRST_ID; ;) {
      const rows = await tables(deps.auth)
        .selectFrom('auth.two_factor as t')
        .innerJoin('auth.user as u', 'u.id', 't.user_id')
        .select(['u.id', 'u.email'])
        .where('t.backup_codes', 'like', `${String(version)}:%`)
        .where('u.id', '>', after)
        .orderBy('u.id')
        .limit(BATCH)
        .execute();
      for (const { email } of rows) {
        counts.backupFound += 1;
        const result = await deps.sender.send({ to: email, ...NOTICE, requestId: deps.requestId });
        if (result.sent) counts.backupNotices += 1;
      }
      const last = rows.at(-1);
      if (last === undefined || rows.length < BATCH) break;
      after = last.id;
    }
  }
}

/** PostgreSQL's SQLSTATE, or a code of our own. Never the error's message, which can hold values. */
const errorCode = (error: unknown): string => {
  const { code } = (error ?? {}) as { code?: unknown };
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : 'reencryption_failed';
};

/**
 * Re-encrypt everything on an older version, then record the event. Returns
 * the counts and, if the run stopped part-way, its error code.
 */
export async function reencryptSecrets(
  deps: RotationDependencies,
): Promise<{ counts: Counts; error?: string }> {
  const counts: Counts = { totp: 0, sso: 0, backupFound: 0, backupNotices: 0 };
  let error: string | undefined;
  try {
    await reencryptTotp(deps, counts);
    await reencryptSso(deps, counts);
    await askForNewBackupCodes(deps, counts);
  } catch (caught) {
    error = errorCode(caught);
    deps.log.error({ errorCode: error }, 'Secret re-encryption stopped');
  }
  await tables(deps.auth)
    .insertInto('auth.audit_event')
    .values({
      request_id: deps.requestId,
      code: 'secrets_re_encrypted',
      reason: error === undefined ? null : 'incomplete',
      key_version: deps.keys.current,
      totp_count: counts.totp,
      sso_count: counts.sso,
      backup_notice_count: counts.backupNotices,
    })
    .execute();
  return error === undefined ? { counts } : { counts, error };
}
