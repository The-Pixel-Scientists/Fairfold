// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The signature callback (ADR 0040, "Callbacks"): every abuse case in the
// ADR's table answers the same as a good callback, nothing is recorded unless
// the provider's signature verified, and nothing returns or logs the
// reference or the body.

import { randomBytes } from 'node:crypto';

import { MAX_CALLBACK_BODY_BYTES } from '@pixel-scientists/domain/documents';
import { describe, expect, it, vi } from 'vitest';

import { Secret } from '../../../config.ts';
import type { AuthSecrets } from '../../../auth/settings.ts';
import {
  callbackSecret,
  CallbackUnavailable,
  createCallbackHandler,
  referenceHash,
} from './callback.ts';
import { FakeEsignProvider, fakeCallback } from './fake.ts';

const TENANT = '6f1c0d8e-3b2a-4c5d-9e7f-1a2b3c4d5e6f';
const OTHER_TENANT = '7a2d1e9f-4c3b-4d6e-8f1a-2b3c4d5e6f70';
const secrets: AuthSecrets = {
  current: 2,
  versions: new Map([
    [1, new Secret('first-auth-secret-of-at-least-32-bytes')],
    [2, new Secret('second-auth-secret-of-at-least-32-bytes')],
  ]),
};
const reference = randomBytes(32).toString('base64url');
const hash = referenceHash(reference);
const json = { 'content-type': 'application/json' };

function setup(known = true) {
  const provider = new FakeEsignProvider();
  const verify = vi.spyOn(provider, 'verifyCallback');
  const resolve = vi.fn(() => Promise.resolve(known ? { tenantId: TENANT, keyVersion: 1 } : null));
  const record = vi.fn(() => Promise.resolve('recorded'));
  const handle = createCallbackHandler({ provider, secrets, resolve, record });
  const secret = callbackSecret(secrets, 1, TENANT, hash) ?? new Uint8Array();
  const signed = (event = 'event-1') => fakeCallback('env-1', event, secret);
  return { handle, resolve, record, verify, secret, signed };
}

describe('a verified callback', () => {
  it('records the provider reference and event id, and nothing else from the body', async () => {
    const { handle, record, signed } = setup();
    const { body, headers } = signed();
    expect(await handle({ reference, body, headers })).toBe('accepted');
    expect(record).toHaveBeenCalledExactlyOnceWith(hash, {
      providerReference: 'env-1',
      eventId: 'event-1',
    });
  });

  it('looks the connection up by the reference hash alone', async () => {
    const { handle, resolve, signed } = setup();
    await handle({ reference, ...signed() });
    expect(resolve).toHaveBeenCalledExactlyOnceWith(hash);
  });
});

describe('every refused callback', () => {
  const cases: Record<
    string,
    (s: ReturnType<typeof setup>) => Parameters<ReturnType<typeof setup>['handle']>[0]
  > = {
    'with no signature': ({ signed }) => ({ reference, body: signed().body, headers: json }),
    'with the wrong signature': ({ signed }) => ({
      reference,
      body: signed().body,
      headers: { ...json, 'x-fake-signature': '00'.repeat(32) },
    }),
    'signed for another connection': () => ({
      reference,
      ...fakeCallback(
        'env-1',
        'event-1',
        callbackSecret(secrets, 1, OTHER_TENANT, hash) ?? new Uint8Array(),
      ),
    }),
    'with a malformed body': ({ secret }) => ({
      reference,
      body: new TextEncoder().encode('{not json'),
      headers: { ...json, 'x-fake-signature': Buffer.from(secret).toString('hex') },
    }),
    'with a reference of the wrong shape': ({ signed }) => ({
      reference: 'short',
      ...signed(),
    }),
  };

  for (const [name, make] of Object.entries(cases)) {
    it(`${name} answers as a good one does and records nothing`, async () => {
      const s = setup();
      const input = make(s);
      expect({ outcome: await s.handle(input), recorded: s.record.mock.calls.length }).toEqual({
        outcome: 'accepted',
        recorded: 0,
      });
    });
  }

  it('for an unknown reference does the same verification work and records nothing', async () => {
    const known = setup();
    const unknown = setup(false);
    const input = { reference, ...known.signed() };
    expect(await known.handle(input)).toBe(await unknown.handle(input));
    expect(unknown.verify).toHaveBeenCalledTimes(1);
    expect(known.verify).toHaveBeenCalledTimes(1);
    expect(known.record).toHaveBeenCalledTimes(1);
    expect(unknown.record).not.toHaveBeenCalled();
  });

  it('for a key version the cell does not hold records nothing', async () => {
    const provider = new FakeEsignProvider();
    const record = vi.fn(() => Promise.resolve('recorded'));
    const handle = createCallbackHandler({
      provider,
      secrets,
      resolve: () => Promise.resolve({ tenantId: TENANT, keyVersion: 9 }),
      record,
    });
    const secret = callbackSecret(secrets, 1, TENANT, hash) ?? new Uint8Array();
    expect(await handle({ reference, ...fakeCallback('env-1', 'e', secret) })).toBe('accepted');
    expect(record).not.toHaveBeenCalled();
  });

  it('treats a provider that throws while verifying as unverified', async () => {
    const s = setup();
    s.verify.mockRejectedValueOnce(new Error('boom'));
    expect(await s.handle({ reference, ...s.signed() })).toBe('accepted');
    expect(s.record).not.toHaveBeenCalled();
  });

  it('answers a record that fails like any other, with nothing leaked', async () => {
    const s = setup();
    s.record.mockRejectedValueOnce(new Error(`database said ${reference}`));
    await expect(s.handle({ reference, ...s.signed() })).resolves.toBe('accepted');
  });
});

describe('before the lookup', () => {
  it('refuses a body over the cap and any type but JSON, without touching the database', async () => {
    const s = setup();
    const big = new Uint8Array(MAX_CALLBACK_BODY_BYTES + 1);
    expect(await s.handle({ reference, body: big, headers: json })).toBe('too_large');
    const { body } = s.signed();
    const bad: Record<string, string>[] = [
      {},
      { 'content-type': 'text/plain' },
      { 'content-type': 'application/xml' },
      { 'content-type': 'multipart/form-data' },
    ];
    for (const headers of bad) {
      expect(await s.handle({ reference, body, headers })).toBe('unsupported_type');
    }
    const typed = { 'content-type': 'Application/JSON; charset=utf-8' };
    expect(await s.handle({ reference, body, headers: typed })).toBe('accepted');
    expect(s.resolve).toHaveBeenCalledTimes(1);
  });

  it('answers 503 only when the lookup itself cannot be made, without the reference', async () => {
    const provider = new FakeEsignProvider();
    const handle = createCallbackHandler({
      provider,
      secrets,
      resolve: () => Promise.reject(new Error(`could not look up ${reference}`)),
      record: () => Promise.resolve(),
    });
    const error = await handle({ reference, body: new Uint8Array(), headers: json }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(CallbackUnavailable);
    expect((error as Error).message).not.toContain(reference);
  });
});

describe('the callback secret', () => {
  it('is derived per key version, tenant and reference, and never the same twice', () => {
    const base = callbackSecret(secrets, 1, TENANT, hash);
    expect(base).toHaveLength(32);
    const others = [
      callbackSecret(secrets, 2, TENANT, hash),
      callbackSecret(secrets, 1, OTHER_TENANT, hash),
      callbackSecret(secrets, 1, TENANT, referenceHash(randomBytes(32).toString('base64url'))),
    ];
    for (const other of others)
      expect(Buffer.from(other ?? []).equals(Buffer.from(base ?? []))).toBe(false);
    expect(
      Buffer.from(callbackSecret(secrets, 1, TENANT, hash) ?? []).equals(Buffer.from(base ?? [])),
    ).toBe(true);
  });

  it('is nothing for a key version the cell does not hold', () => {
    expect(callbackSecret(secrets, 3, TENANT, hash)).toBeNull();
  });
});
