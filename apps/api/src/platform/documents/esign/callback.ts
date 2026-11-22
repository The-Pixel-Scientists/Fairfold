// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The signature callback (ADR 0040, "Callbacks"; the contract is in
// packages/domain/src/documents/routes.ts), the one unauthenticated way in to
// tenant data, kept as small as it can be. It sets no tenant (ADR 0019). The
// reference in the path names a connection and only its SHA-256 is looked up,
// through the approved function app.resolve_signature_callback(). Nothing
// here reads app.signature_request or app.tenant, and no tenant, request id
// or status is taken from the body: a verified body is a hint, and the worker
// asks the provider what changed.
//
// Order: size and type, then the lookup, then the provider's signature over
// the raw body with the secret derived for that connection, then the body is
// parsed, then the hint is recorded. An unknown reference is verified against
// a secret derived the same way for a fixed tenant, so it costs the same
// work, and every outcome after the lookup answers the same. Nothing logs or
// returns the reference, the body or a reason.

import { createHash, hkdfSync } from 'node:crypto';

import type { Kysely } from '@pixel-scientists/db';
import {
  callbackHintSchema,
  MAX_CALLBACK_BODY_BYTES,
  type SignatureProvider,
} from '@pixel-scientists/domain/documents';

import type { AuthSecrets } from '../../../auth/settings.ts';
import { SafeError } from '../../../serialize-error.ts';

/** The connection a reference names: its tenant and the key version its secret derives from. */
export interface ResolvedConnection {
  readonly tenantId: string;
  readonly keyVersion: number;
}

/** A callback as the route hands it over: the raw bytes and the headers in lower case. */
export interface CallbackInput {
  readonly reference: string;
  readonly body: Uint8Array;
  readonly headers: Readonly<Record<string, string>>;
}

/** `accepted` answers 204 for every callback past the checks of size and type. */
export type CallbackOutcome = 'accepted' | 'too_large' | 'unsupported_type';

/** The database could not be reached for the lookup: the one case that answers 503. */
export class CallbackUnavailable extends SafeError {
  constructor(options?: ErrorOptions) {
    super('The callback could not be looked up.', options);
    this.name = 'CallbackUnavailable';
  }
}

export interface CallbackDependencies {
  /** The cell's live adapter, which verifies and parses. */
  readonly provider: SignatureProvider;
  readonly secrets: AuthSecrets;
  /** app.resolve_signature_callback(): the connection of an active tenant, or null. */
  readonly resolve: (referenceHash: Buffer) => Promise<ResolvedConnection | null>;
  /** Records the verified hint for the worker (ADR 0040's app.record_signature_callback()). */
  readonly record: (
    referenceHash: Buffer,
    hint: { readonly providerReference: string; readonly eventId: string },
  ) => Promise<unknown>;
}

/** The SHA-256 of the reference's 32 bytes: all that is stored, and all that is looked up. */
export const referenceHash = (reference: string): Buffer =>
  createHash('sha256').update(Buffer.from(reference, 'base64url')).digest();

/** Stands in for a tenant when the reference is unknown, so the derivation costs the same. */
const UNKNOWN_TENANT = '00000000-0000-4000-8000-000000000000';

/**
 * The secret a connection's callbacks are signed with, for the operator to
 * set at the provider and for this handler to verify with. Derived, never
 * stored (ADR 0040): HKDF-SHA-256 of the auth secret of the connection's key
 * version, for this purpose, the tenant and the reference's SHA-256. Null for
 * a key version the cell does not hold.
 */
export function callbackSecret(
  secrets: AuthSecrets,
  keyVersion: number,
  tenantId: string,
  hash: Buffer,
): Uint8Array | null {
  const secret = secrets.versions.get(keyVersion);
  if (secret === undefined) return null;
  const purpose = ['tps-signature-callback', tenantId, hash.toString('hex')].join('\0');
  return new Uint8Array(hkdfSync('sha256', secret.reveal(), '', purpose, 32));
}

/** app.resolve_signature_callback() as app_api, outside any tenant. */
export async function resolveCallback(
  db: Kysely<unknown>,
  hash: Buffer,
): Promise<ResolvedConnection | null> {
  const row = await db
    .selectFrom((eb) =>
      eb
        .fn<{ tenant_id: string; callback_key_version: number }>('app.resolve_signature_callback', [
          eb.val(hash),
        ])
        .as('found'),
    )
    .selectAll()
    .executeTakeFirst();
  return row === undefined
    ? null
    : { tenantId: row.tenant_id, keyVersion: row.callback_key_version };
}

const isJson = (contentType: string | undefined): boolean =>
  contentType?.split(';')[0]?.trim().toLowerCase() === 'application/json';

export function createCallbackHandler(deps: CallbackDependencies) {
  return async function handleCallback(input: CallbackInput): Promise<CallbackOutcome> {
    if (input.body.byteLength > MAX_CALLBACK_BODY_BYTES) return 'too_large';
    if (!isJson(input.headers['content-type'])) return 'unsupported_type';

    const hash = referenceHash(input.reference);
    let found: ResolvedConnection | null;
    try {
      found = await deps.resolve(hash);
    } catch (error) {
      throw new CallbackUnavailable({ cause: error });
    }
    const secret = callbackSecret(
      deps.secrets,
      found?.keyVersion ?? deps.secrets.current,
      found?.tenantId ?? UNKNOWN_TENANT,
      hash,
    );
    let verified = false;
    try {
      verified = await deps.provider.verifyCallback(
        { body: input.body, headers: input.headers },
        secret ?? new Uint8Array(32),
      );
    } catch {
      // A provider that cannot check a body has not verified it.
    }
    if (found === null || secret === null || !verified) return 'accepted';
    try {
      const hint = callbackHintSchema.parse(deps.provider.parseCallback(input.body));
      await deps.record(hash, hint);
    } catch {
      // A body that does not parse, or a hint that cannot be recorded, is answered like any other.
    }
    return 'accepted';
  };
}
