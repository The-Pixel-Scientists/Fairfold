// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The may-contact check against the test database, as app_worker (the role
// that sends mail) in a tenant's transaction: consent, withdrawal,
// suppression, erasure and no address each give their code, a transactional
// message needs no consent, and another tenant's person is refused the same
// way as an erased one.

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../../../../../packages/db/src/database.ts';
import { trustedTenantId, withTenant } from '../../../../../packages/db/src/tenant-context.ts';
import { databaseSettings } from '../../../../../packages/db/test/connect.ts';
import { addPerson } from '../../../../../packages/db/test/party/fixtures.ts';
import {
  addMember,
  asMigratorIn,
  createTestTenant,
  insertRow,
  type TestTenant,
} from '../../../../../packages/db/test/tenants.ts';
import type { MayContactInput } from '../../contracts/index.ts';
import { emailRecipient, mayContact } from './index.ts';

let db: ReturnType<typeof createDatabase<unknown>>;
let a: TestTenant;
let b: TestTenant;
let member: string;
let personInB: string;

const marketing = { kind: 'marketing', purpose: 'future_funding' } as const;

beforeAll(async () => {
  const { host, port, database, password } = databaseSettings('app_worker', 4);
  db = createDatabase<unknown>({
    host,
    port,
    database,
    password,
    role: 'app_worker',
    maxConnections: 4,
    applicationName: 'tps-db-tests',
  });
  [a, b] = await Promise.all([createTestTenant(), createTestTenant()]);
  member = await asMigratorIn(a.id, (client) => addMember(client, a));
  personInB = await asMigratorIn(b.id, (client) => addPerson(client, b));
}, 60_000);

afterAll(async () => {
  await db.destroy();
});

const addPersonA = (change: Record<string, unknown> = {}) =>
  asMigratorIn(a.id, (client) => addPerson(client, a, change));

const consent = (person: string, state: 'given' | 'withdrawn') =>
  asMigratorIn(a.id, (client) =>
    insertRow(client, 'party.consent', {
      tenant_id: a.id,
      person_id: person,
      purpose: 'future_funding',
      channel: 'email',
      state,
      privacy_notice_version: 'v1',
      source: 'staff',
      recorded_by: member,
    }),
  );

const suppress = (person: string) =>
  asMigratorIn(a.id, (client) =>
    insertRow(client, 'party.suppression', {
      tenant_id: a.id,
      person_id: person,
      channel: 'email',
      reason: 'staff_entry',
      source: 'staff',
      recorded_by: member,
    }),
  );

const check = (tenant: TestTenant, personId: string, message: MayContactInput['message']) =>
  withTenant(db, trustedTenantId(tenant.id), (tx) =>
    mayContact(tx, { personId, channel: 'email', message }),
  );

describe('mayContact for marketing', () => {
  it('refuses a person who has not chosen', async () => {
    expect(await check(a, await addPersonA(), marketing)).toEqual({
      allowed: false,
      code: 'no_consent',
    });
  });

  it('allows given consent, and refuses it once withdrawn', async () => {
    const person = await addPersonA();
    await consent(person, 'given');
    expect(await check(a, person, marketing)).toEqual({ allowed: true });
    await consent(person, 'withdrawn');
    expect(await check(a, person, marketing)).toEqual({
      allowed: false,
      code: 'consent_withdrawn',
    });
  });

  it('refuses a suppressed person even with given consent', async () => {
    const person = await addPersonA();
    await consent(person, 'given');
    await suppress(person);
    expect(await check(a, person, marketing)).toEqual({ allowed: false, code: 'suppressed' });
  });

  it('refuses an erased person', async () => {
    const person = await addPersonA();
    await consent(person, 'given');
    await asMigratorIn(a.id, async (client) => {
      await client.query(
        'UPDATE party.person SET given_name = NULL, family_name = NULL, phone = NULL, email = $2 WHERE id = $1',
        [person, `${person}@erased.invalid`],
      );
      await client.query("UPDATE party.party SET status = 'erased' WHERE id = $1", [person]);
    });
    expect(await check(a, person, marketing)).toEqual({ allowed: false, code: 'person_erased' });
  });

  it('refuses a channel with no address, and an input that is not valid', async () => {
    const person = await addPersonA();
    expect(
      await withTenant(db, trustedTenantId(a.id), (tx) =>
        mayContact(tx, { personId: person, channel: 'post', message: marketing }),
      ),
    ).toEqual({ allowed: false, code: 'no_contact_point' });
    expect(
      await withTenant(db, trustedTenantId(a.id), (tx) =>
        mayContact(tx, {
          personId: person,
          channel: 'email',
          message: { kind: 'marketing' },
        } as never),
      ),
    ).toEqual({ allowed: false, code: 'no_consent' });
  });
});

describe('mayContact for a transactional message', () => {
  it('needs no consent, and is refused only for an erased person', async () => {
    expect(await check(a, await addPersonA(), { kind: 'transactional' })).toEqual({
      allowed: true,
    });
    expect(await check(a, randomUUID(), { kind: 'transactional' })).toEqual({
      allowed: false,
      code: 'person_erased',
    });
  });
});

// Pins a known gap, not the intended rule: the check matches a suppression by person only. ADR 0033
// also matches by address hash and refuses all mail on a bounced address. That needs the suppression
// key and a bounce release table, so it is deferred; when it lands, these expectations flip.
describe('suppressions by address hash (deferred)', () => {
  const bounce = (person: string) =>
    asMigratorIn(a.id, (client) =>
      insertRow(client, 'party.suppression', {
        tenant_id: a.id,
        person_id: person,
        channel: 'email',
        reason: 'bounced',
        source: 'system',
        address_hash: Buffer.alloc(32, 7),
        hash_key_version: 1,
      }),
    );

  it('does not yet refuse mail to a bounced address, transactional or marketing', async () => {
    const person = await addPersonA();
    await consent(person, 'given');
    await bounce(person);

    expect(await check(a, person, { kind: 'transactional' })).toEqual({ allowed: true });
    expect(await check(a, person, marketing)).toEqual({ allowed: true });
  });

  it('does not yet refuse a new record that shares a suppressed address hash', async () => {
    const objector = await addPersonA();
    await asMigratorIn(a.id, (client) =>
      insertRow(client, 'party.suppression', {
        tenant_id: a.id,
        person_id: objector,
        channel: 'email',
        reason: 'unsubscribed',
        purpose: 'future_funding',
        source: 'unsubscribe',
        address_hash: Buffer.alloc(32, 9),
        hash_key_version: 1,
      }),
    );
    const again = await addPersonA();
    await consent(again, 'given');

    expect(await check(a, again, marketing)).toEqual({ allowed: true });
  });
});

describe('across tenants', () => {
  it("answers another tenant's person as it would an erased one, and reads no address", async () => {
    expect(await check(a, personInB, { kind: 'transactional' })).toEqual({
      allowed: false,
      code: 'person_erased',
    });
    expect(await check(a, personInB, marketing)).toEqual({
      allowed: false,
      code: 'person_erased',
    });
    expect(
      await withTenant(db, trustedTenantId(a.id), (tx) => emailRecipient(tx, personInB)),
    ).toBeNull();
  });

  it('reads the address and tenant of its own person', async () => {
    const person = await addPersonA({ email: 'ada@example.test' });
    expect(await withTenant(db, trustedTenantId(a.id), (tx) => emailRecipient(tx, person))).toEqual(
      { tenantId: a.id, address: 'ada@example.test' },
    );
  });
});
