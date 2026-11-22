// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The callback handler against the test database, with the real lookup
// through app.resolve_signature_callback() as app_api: a reference reaches its
// own connection's tenant and no other, a callback signed for one tenant is
// worthless under another's reference, and a closed connection or a
// suspended tenant resolves to nothing.

import { randomBytes } from 'node:crypto';

import { createDatabase } from '@pixel-scientists/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { connectionSettings } from '../../../../../../packages/db/test/connect.ts';
import { connectionRow } from '../../../../../../packages/db/test/documents/fixtures.ts';
import {
  asMigratorIn,
  createTestTenant,
  insertRow,
  type TestTenant,
} from '../../../../../../packages/db/test/tenants.ts';
import type { AuthSecrets } from '../../../auth/settings.ts';
import { Secret } from '../../../config.ts';
import {
  callbackSecret,
  createCallbackHandler,
  referenceHash,
  resolveCallback,
} from './callback.ts';
import { FakeEsignProvider, fakeCallback } from './fake.ts';

vi.setConfig({ testTimeout: 60_000 });

const secrets: AuthSecrets = {
  current: 1,
  versions: new Map([[1, new Secret('auth-secret-for-the-callback-test-0123456789')]]),
};

interface Funder {
  readonly tenant: TestTenant;
  readonly reference: string;
}

let api: ReturnType<typeof createDatabase<unknown>>;
let a: Funder;
let b: Funder;
let closed: Funder;
let suspended: Funder;

async function addFunder(change: 'active' | 'closed' | 'suspended' = 'active'): Promise<Funder> {
  const tenant = await createTestTenant();
  const reference = randomBytes(32).toString('base64url');
  await asMigratorIn(tenant.id, async (client) => {
    const id = await insertRow(
      client,
      'app.signature_connection',
      connectionRow(tenant, { callback_reference_hash: referenceHash(reference) }),
    );
    if (change === 'closed') {
      await client.query("UPDATE app.signature_connection SET status = 'closed' WHERE id = $1", [
        id,
      ]);
    }
    if (change === 'suspended') {
      await client.query("UPDATE app.tenant SET status = 'suspended' WHERE id = $1", [tenant.id]);
    }
  });
  return { tenant, reference };
}

beforeAll(async () => {
  const settings = connectionSettings('app_api');
  api = createDatabase<unknown>({
    host: settings.host,
    port: settings.port,
    database: settings.database,
    role: 'app_api',
    password: settings.password,
    maxConnections: 2,
    applicationName: 'tps-db-tests',
  });
  [a, b, closed, suspended] = [
    await addFunder(),
    await addFunder(),
    await addFunder('closed'),
    await addFunder('suspended'),
  ];
}, 60_000);
afterAll(() => api.destroy());

function setup() {
  const record = vi.fn(() => Promise.resolve('recorded'));
  const handle = createCallbackHandler({
    provider: new FakeEsignProvider(),
    secrets,
    resolve: (hash) => resolveCallback(api, hash),
    record,
  });
  const signedFor = (funder: Funder) =>
    fakeCallback(
      'env-1',
      'event-1',
      callbackSecret(secrets, 1, funder.tenant.id, referenceHash(funder.reference)) ??
        new Uint8Array(),
    );
  return { handle, record, signedFor };
}

describe('resolving a callback reference', () => {
  it("finds each reference's own tenant and key version, and nothing for any other", async () => {
    expect(await resolveCallback(api, referenceHash(a.reference))).toEqual({
      tenantId: a.tenant.id,
      keyVersion: 1,
    });
    expect((await resolveCallback(api, referenceHash(b.reference)))?.tenantId).toBe(b.tenant.id);
    for (const { reference } of [closed, suspended]) {
      expect(await resolveCallback(api, referenceHash(reference))).toBeNull();
    }
    expect(
      await resolveCallback(api, referenceHash(randomBytes(32).toString('base64url'))),
    ).toBeNull();
  });
});

describe('a callback', () => {
  it("signed for a tenant's connection is recorded under its own reference", async () => {
    const { handle, record, signedFor } = setup();
    expect(await handle({ reference: a.reference, ...signedFor(a) })).toBe('accepted');
    expect(record).toHaveBeenCalledExactlyOnceWith(referenceHash(a.reference), {
      providerReference: 'env-1',
      eventId: 'event-1',
    });
  });

  it("signed for tenant A and sent to B's reference never records under B", async () => {
    const { handle, record, signedFor } = setup();
    expect(await handle({ reference: b.reference, ...signedFor(a) })).toBe('accepted');
    expect(record).not.toHaveBeenCalled();
  });

  it('for a closed connection or a suspended tenant records nothing, and answers the same', async () => {
    const { handle, record, signedFor } = setup();
    for (const funder of [closed, suspended]) {
      expect(await handle({ reference: funder.reference, ...signedFor(funder) })).toBe('accepted');
    }
    expect(record).not.toHaveBeenCalled();
  });
});
