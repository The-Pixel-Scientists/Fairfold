// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The secret re-encryption command against the test database, as app_auth:
// TOTP and SSO secrets move from key version 41 to 42 with their plaintext,
// last used step and row binding unchanged, a suspended tenant's provider
// included; a second run changes nothing; users with version 41 backup codes
// are emailed; one event records the counts; and nothing secret is printed
// or logged. Versions 41 and 42 are used by no other test.

import { randomBytes, randomUUID } from 'node:crypto';

import { createDatabase, withTenant } from '@pixel-scientists/db';
import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { trustedTenantId } from '../../../../../packages/db/src/tenant-context.ts';
import {
  oidcProvider,
  samlProvider,
  CERTIFICATE,
} from '../../../../../packages/db/test/auth/sso/fixtures.ts';
import { connectionSettings, withClient } from '../../../../../packages/db/test/connect.ts';
import {
  asMigratorIn,
  createTestTenant,
  createTestUser,
  insertRow,
  type TestTenant,
} from '../../../../../packages/db/test/tenants.ts';
import { captureLogs, smtpTestSettings } from '../../../test/support.ts';
import { Secret } from '../../config.ts';
import type { Email, Sender } from '../../email/sender.ts';
import { createLogger } from '../../logger.ts';
import { openSecret, sealSecret } from '../sso/secrets.ts';
import { codeAt, stepAt } from '../totp.ts';
import { runSecretReencryption } from './command.ts';
import { reencryptSecrets, rotationKeys } from './reencrypt.ts';

const OLD = new Secret('rotation test secret, key version forty-one');
const NEW = new Secret('rotation test secret, key version forty-two');
const before = rotationKeys({ current: 41, versions: new Map([[41, OLD]]) });
const keys = rotationKeys({
  current: 42,
  versions: new Map([
    [41, OLD],
    [42, NEW],
  ]),
});
const TOTP_PLAIN = randomBytes(16).toString('hex');
const CLIENT_SECRET = `client secret ${randomUUID()}`;
const PRIVATE_KEY = `private key ${randomUUID()}`;

const settings = connectionSettings('app_auth');
const env = {
  ...smtpTestSettings,
  TPS_DEV: '1',
  TPS_DB_HOST: settings.host,
  TPS_DB_PORT: String(settings.port),
  TPS_DB_NAME: settings.database,
  TPS_DB_APP_AUTH_PASSWORD: settings.password,
  TPS_CONSOLE_ORIGIN: 'https://console.example.org',
  TPS_PORTAL_ORIGIN: 'https://apply.example.org',
};
const auth = createDatabase<unknown>({
  host: settings.host,
  port: settings.port,
  database: settings.database,
  role: 'app_auth',
  password: settings.password,
  maxConnections: 2,
  applicationName: 'tps-db-tests',
});
afterAll(() => auth.destroy());

const sent: Email[] = [];
const sender: Sender = {
  send(email) {
    sent.push(email);
    return Promise.resolve({ sent: true });
  },
};

/** Both versions, as an operator sets them, with 42 sealing new values. */
const rotating = {
  TPS_AUTH_SECRET_41: OLD.reveal(),
  TPS_AUTH_SECRET_42: NEW.reveal(),
  TPS_AUTH_SECRET_CURRENT: '42',
};

async function run(secrets: Record<string, string>) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runSecretReencryption(
    { ...env, ...secrets },
    { out: (text) => out.push(text), err: (text) => err.push(text) },
    { sender },
  );
  return { code, out, err, text: [...out, ...err].join('\n') };
}

let active: TestTenant;
let suspended: TestTenant;
let userId: string;
let email: string;
const STEP = stepAt(Date.now()) - 1;
const providers: { id: string; tenant: TestTenant; column: 'client_secret' | 'sp_private_key' }[] =
  [];

const twoFactor = () =>
  withClient('app_auth', async (client) => {
    const { rows } = await client.query<{ secret: string; last_used_step: string }>(
      'SELECT secret, last_used_step FROM auth.two_factor WHERE user_id = $1',
      [userId],
    );
    return rows[0];
  });

const provider = (tenant: TestTenant, id: string) =>
  asMigratorIn(tenant.id, async (client) => {
    const { rows } = await client.query<{
      key_version: number;
      client_secret: Buffer | null;
      sp_private_key: Buffer | null;
    }>('SELECT key_version, client_secret, sp_private_key FROM auth.sso_provider WHERE id = $1', [
      id,
    ]);
    return rows[0];
  });

beforeAll(async () => {
  [active, suspended] = await Promise.all([createTestTenant(), createTestTenant()]);
  userId = await createTestUser();
  const secret = await symmetricEncrypt({ key: before.totp, data: TOTP_PLAIN });
  email = await withClient('app_auth', async (client) => {
    await client.query(
      'INSERT INTO auth.two_factor (user_id, secret, verified) VALUES ($1, $2, true)',
      [userId, secret],
    );
    await client.query(
      'UPDATE auth.two_factor SET last_used_step = $2, backup_codes = $3 WHERE user_id = $1',
      [userId, STEP, `41:${randomBytes(32).toString('hex')}`],
    );
    const { rows } = await client.query<{ email: string }>(
      'SELECT email FROM auth."user" WHERE id = $1',
      [userId],
    );
    return rows[0]?.email ?? '';
  });

  for (const [tenant, kind] of [
    [active, 'oidc'],
    [suspended, 'saml'],
  ] as const) {
    const id = randomUUID();
    const column = kind === 'oidc' ? 'client_secret' : 'sp_private_key';
    const value = kind === 'oidc' ? CLIENT_SECRET : PRIVATE_KEY;
    const { sealed } = sealSecret(
      before.sso,
      { column, providerId: id, tenantId: tenant.id },
      value,
    );
    await asMigratorIn(tenant.id, async (client) => {
      const row =
        kind === 'oidc'
          ? await oidcProvider(client, tenant, 41)
          : {
              ...(await samlProvider(client, tenant)),
              sp_certificate: CERTIFICATE,
              key_version: 41,
            };
      await insertRow(client, 'auth.sso_provider', { ...row, id, [column]: sealed });
    });
    providers.push({ id, tenant, column });
  }
  await asMigratorIn(suspended.id, (client) =>
    client.query("UPDATE app.tenant SET status = 'suspended' WHERE id = $1", [suspended.id]),
  );
});

describe('the secret re-encryption command', { timeout: 60_000 }, () => {
  it('refuses to start with one key version or failing auth settings', async () => {
    for (const one of [
      { TPS_AUTH_SECRET: NEW.reveal() },
      { TPS_AUTH_SECRET_42: NEW.reveal() },
    ] as Record<string, string>[]) {
      const result = await run(one);
      expect(result.code).toBe(2);
      expect(result.err).toEqual([
        'Only one auth key version is configured, so there is nothing to re-encrypt.',
      ]);
    }
    const short = await run({ ...rotating, TPS_AUTH_SECRET_41: 'too short' });
    expect(short.code).toBe(2);
    expect(short.err).toEqual(['TPS_AUTH_SECRET_41 must be at least 32 bytes.']);
    const unnamed = await run({ ...rotating, TPS_AUTH_SECRET_CURRENT: '' });
    expect(unnamed.code).toBe(2);
    expect(unnamed.err).toEqual([
      'More than one auth key version is set, so set TPS_AUTH_SECRET_CURRENT.',
    ]);
    expect((await twoFactor())?.secret.startsWith('$ba$41$')).toBe(true);
  });

  it('re-encrypts TOTP and SSO secrets to the current version, and records the counts', async () => {
    const result = await run(rotating);
    expect(result.code).toBe(0);

    const row = await twoFactor();
    expect(row?.secret.startsWith('$ba$42$')).toBe(true);
    const plain = await symmetricDecrypt({ key: keys.totp, data: row?.secret ?? '' });
    expect(plain).toBe(TOTP_PLAIN);
    // A code valid before is valid after, and the used step stays used.
    expect(codeAt(Buffer.from(plain), STEP + 1)).toBe(codeAt(Buffer.from(TOTP_PLAIN), STEP + 1));
    expect(Number(row?.last_used_step)).toBe(STEP);

    const [oidc, saml] = providers;
    for (const [place, value] of [
      [oidc, CLIENT_SECRET],
      [saml, PRIVATE_KEY],
    ] as const) {
      if (place === undefined) throw new Error('No provider.');
      const stored = await provider(place.tenant, place.id);
      expect(stored?.key_version).toBe(42);
      const sealed = stored?.[place.column] ?? Buffer.alloc(0);
      const bound = { column: place.column, providerId: place.id, tenantId: place.tenant.id };
      expect(openSecret(keys.sso, bound, sealed, 42)).toBe(value);
      // The value still opens only where it was sealed.
      const elsewhere = [
        { ...bound, providerId: randomUUID() },
        { ...bound, tenantId: randomUUID() },
      ];
      for (const other of elsewhere)
        expect(() => openSecret(keys.sso, other, sealed, 42)).toThrow();
    }

    const notice = sent.find((message) => message.to === email);
    expect(notice?.subject).toBe('Generate new backup codes');
    expect(notice?.text).not.toMatch(/4[12]|[0-9a-f]{20}/);

    const events = await withClient('app_auth', (client) =>
      client.query<Record<string, unknown> & { totp_count: number; sso_count: number }>(
        `SELECT key_version, totp_count, sso_count, backup_notice_count, reason, user_id,
                tenant_id, identifier, ip_address
           FROM auth.audit_event WHERE code = 'secrets_re_encrypted'
          ORDER BY occurred_at DESC LIMIT 1`,
      ),
    );
    expect(events.rows[0]).toMatchObject({ key_version: 42, reason: null, user_id: null });
    expect(events.rows[0]).toMatchObject({ tenant_id: null, identifier: null, ip_address: null });
    expect(events.rows[0]?.totp_count).toBeGreaterThanOrEqual(1);
    expect(events.rows[0]?.sso_count).toBeGreaterThanOrEqual(2);

    for (const secret of [OLD.reveal(), NEW.reveal(), TOTP_PLAIN, CLIENT_SECRET, email, userId]) {
      expect(result.text).not.toContain(secret);
    }
    for (const { id, tenant } of providers) {
      expect(result.text).not.toContain(id);
      expect(result.text).not.toContain(tenant.id);
    }
  });

  it('changes nothing when run again', async () => {
    const [totp, oidc] = [await twoFactor(), providers[0]];
    const sealed = oidc && (await provider(oidc.tenant, oidc.id));
    const again = await run(rotating);
    expect(again.code).toBe(0);
    expect(again.out.slice(0, 2)).toEqual([
      'Re-encrypted 0 TOTP secrets to key version 42.',
      'Re-encrypted 0 SSO providers to key version 42.',
    ]);
    expect(await twoFactor()).toEqual(totp);
    expect(oidc && (await provider(oidc.tenant, oidc.id))).toEqual(sealed);
  });

  it("cannot read or write another tenant's provider while one tenant is set", async () => {
    const other = providers[1];
    if (other === undefined) throw new Error('No provider.');
    const changed = await withTenant(auth, trustedTenantId(active.id), async (trx) => {
      const db = trx.$extendTables<{ 'auth.sso_provider': { id: string; name: string } }>();
      const read = await db
        .selectFrom('auth.sso_provider')
        .select('id')
        .where('id', '=', other.id)
        .execute();
      const update = await db
        .updateTable('auth.sso_provider')
        .set({ name: 'Taken' })
        .where('id', '=', other.id)
        .executeTakeFirst();
      return { read, updated: update.numUpdatedRows };
    });
    expect(changed).toEqual({ read: [], updated: 0n });
  });

  it('records the counts it reached when a value fails to open, and logs only a code', async () => {
    const broken = randomUUID();
    await asMigratorIn(active.id, async (client) =>
      insertRow(client, 'auth.sso_provider', {
        ...(await oidcProvider(client, active, 41)),
        id: broken,
      }),
    );
    const logs = captureLogs();
    try {
      const { counts, error } = await reencryptSecrets({
        auth,
        keys,
        sender,
        log: createLogger({ level: 'info', destination: logs.stream }),
        requestId: randomUUID(),
      });
      expect(error).toBe('reencryption_failed');
      expect(counts.sso).toBe(0);
      expect(logs.lines()).toEqual([
        expect.objectContaining({
          errorCode: 'reencryption_failed',
          msg: 'Secret re-encryption stopped',
        }),
      ]);
      for (const secret of [OLD.reveal(), NEW.reveal(), broken]) {
        expect(logs.text()).not.toContain(secret);
      }
      const { rows } = await withClient('app_auth', (client) =>
        client.query(
          `SELECT reason FROM auth.audit_event WHERE code = 'secrets_re_encrypted'
            ORDER BY occurred_at DESC LIMIT 1`,
        ),
      );
      expect(rows).toEqual([{ reason: 'incomplete' }]);
    } finally {
      await asMigratorIn(active.id, (client) =>
        client.query('DELETE FROM auth.sso_provider WHERE id = $1', [broken]),
      );
    }
  });
});
