// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The hashes an anonymous response is stored under (ADR 0036). Only keyed
// hashes of the respondent token and of the idempotency key leave the
// process: HMAC-SHA-256 under one server key, each over length-prefixed
// parts under its own label, so no two inputs share a message. The request
// hash is the canonical SHA-256 of the route, path parameters, version and
// cleaned answers, without the proof or the token, so a retry that solved a
// new challenge is still the same request.

const { subtle } = crypto;

function parts(label: string, values: readonly string[]): Buffer {
  return Buffer.concat(
    [label, ...values].map((value) => {
      const bytes = Buffer.from(value, 'utf8');
      const length = Buffer.alloc(4);
      length.writeUInt32BE(bytes.length);
      return Buffer.concat([length, bytes]);
    }),
  );
}

async function mac(key: Uint8Array, label: string, values: readonly string[]): Promise<Buffer> {
  const hmac = await subtle.importKey(
    'raw',
    new Uint8Array(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return Buffer.from(await subtle.sign('HMAC', hmac, new Uint8Array(parts(label, values))));
}

/** The reference's hash: the only form of the respondent token that is stored. */
export const tokenHash = (key: Uint8Array, token: string): Promise<Buffer> =>
  mac(key, 'forms.token', [token]);

/** Scoped to the route and the respondent token, so another token, form or tenant is a new key. */
export const keyHash = (
  key: Uint8Array,
  routeId: string,
  token: string,
  idempotencyKey: string,
): Promise<Buffer> => mac(key, 'forms.key', [routeId, token, idempotencyKey]);

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== 'object' || value === null) return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((name) => [name, canonical(record[name])]),
  );
}

/** Key order and spacing change nothing. */
export async function requestHash(request: {
  readonly routeId: string;
  readonly params: unknown;
  readonly formVersionId: string;
  readonly answers: unknown;
}): Promise<Buffer> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(request)));
  return Buffer.from(await subtle.digest('SHA-256', bytes));
}
