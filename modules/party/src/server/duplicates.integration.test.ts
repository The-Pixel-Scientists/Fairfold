// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Duplicate candidates against the test database as app_api, each call in its
// own tenant transaction. Names, emails and identifier values are invented.

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../../../../packages/db/src/database.ts';
import { trustedTenantId, withTenant } from '../../../../packages/db/src/tenant-context.ts';
import { databaseSettings } from '../../../../packages/db/test/connect.ts';
import { addOrganisation, addPerson } from '../../../../packages/db/test/party/fixtures.ts';
import {
  addMember,
  asMigratorIn,
  createTestTenant,
  insertRow,
  type TestTenant,
} from '../../../../packages/db/test/tenants.ts';
import { duplicateCandidates } from './duplicates.ts';
import type { PartyAudit } from './handlers.ts';
import type { PartyRequest } from './request.ts';
import type { Tx } from './tables.ts';

let db: ReturnType<typeof createDatabase<unknown>>;
let a: TestTenant;
let b: TestTenant;
let memberA: string;

const inTenant = <T>(tenant: TestTenant, work: (tx: Tx) => Promise<T>): Promise<T> =>
  withTenant(db, trustedTenantId(tenant.id), work);

function request(tx: Tx) {
  const events: Record<string, unknown>[] = [];
  const audit: PartyAudit = {
    record: (event) => Promise.resolve(void events.push({ read: false, ...event })),
    read: (event) => Promise.resolve(void events.push({ read: true, ...event })),
  };
  return { events, request: { tx, audit, membership: { id: memberA } } satisfies PartyRequest };
}

const org = (tenant: TestTenant, change = {}) =>
  asMigratorIn(tenant.id, (client) => addOrganisation(client, tenant, change));
const person = (tenant: TestTenant, change = {}) =>
  asMigratorIn(tenant.id, (client) => addPerson(client, tenant, change));
const link = (tenant: TestTenant, personId: string, organisationId: string) =>
  asMigratorIn(tenant.id, (client) =>
    insertRow(client, 'party.relationship', {
      tenant_id: tenant.id,
      type: 'contact_for',
      subject_id: personId,
      subject_kind: 'person',
      object_id: organisationId,
      object_kind: 'organisation',
    }),
  );
const identifier = (
  tenant: TestTenant,
  organisationId: string,
  scheme: string,
  value: string,
  verifier?: string,
) =>
  asMigratorIn(tenant.id, async (client) => {
    const id = await insertRow(client, 'party.organisation_identifier', {
      tenant_id: tenant.id,
      organisation_id: organisationId,
      scheme,
      identifier: value,
    });
    if (verifier !== undefined) {
      await client.query(
        'UPDATE party.organisation_identifier SET verified_by = $1 WHERE id = $2',
        [verifier, id],
      );
    }
    return id;
  });

beforeAll(async () => {
  const { host, port, database, password } = databaseSettings('app_api', 4);
  db = createDatabase({
    host,
    port,
    database,
    password,
    role: 'app_api',
    maxConnections: 4,
    applicationName: 'tps-db-tests',
  });
  [a, b] = await Promise.all([createTestTenant(), createTestTenant()]);
  memberA = await asMigratorIn(a.id, (client) => addMember(client, a));
}, 60_000);

afterAll(async () => {
  await db.destroy();
});

describe('duplicateCandidates', () => {
  const candidates = (tenant: TestTenant, id: string) =>
    inTenant(tenant, async (tx) => {
      const { events, request: ctx } = request(tx);
      return { events, found: await duplicateCandidates(ctx, id) };
    });

  it('ranks organisations by identifier, then name and postcode, then name, and leaves out merged parties', async () => {
    const postcode = 'BR1 4TT';
    const subject = await org(a, {
      name: 'Brightside Allotment Society',
      address_postcode: postcode,
    });
    const verifiedMatch = await org(a, { name: 'Unrelated Name One' });
    const claimedMatch = await org(a, { name: 'Unrelated Name Two' });
    const nameMatch = await org(a, {
      name: 'Brightside Allotments Society',
      address_postcode: 'BR9 9ZZ',
    });
    const postcodeMatch = await org(a, {
      name: 'Brightside Allotment Garden',
      address_postcode: postcode,
    });
    const postcodeOnly = await org(a, { name: 'Zebra Crossing Club', address_postcode: postcode });
    const gone = await org(a, { name: 'Brightside Allotment Society' });
    await identifier(a, subject, 'GB-CHC', '1000031', memberA);
    await identifier(a, verifiedMatch, 'GB-CHC', '1000031');
    await identifier(a, subject, 'GB-COH', '01000032');
    await identifier(a, claimedMatch, 'GB-COH', '01000032');
    await asMigratorIn(a.id, (client) =>
      client.query("UPDATE party.party SET status = 'merged', merged_into = $2 WHERE id = $1", [
        gone,
        subject,
      ]),
    );

    const { events, found } = await candidates(a, subject);

    expect(found).toEqual([
      { partyId: verifiedMatch, signals: ['verified_identifier'] },
      { partyId: claimedMatch, signals: ['claimed_identifier'] },
      { partyId: postcodeMatch, signals: ['name_and_postcode'] },
      { partyId: nameMatch, signals: ['name'] },
    ]);
    expect(found.map((c) => c.partyId)).not.toContain(postcodeOnly);
    expect(found.map((c) => c.partyId)).not.toContain(gone);
    expect(events).toEqual([]);
  });

  it('finds people by email, or by a similar name at the same organisation, and audits the read', async () => {
    const charity = await org(a);
    const subject = await person(a, {
      given_name: 'Ada',
      family_name: 'Lovelace',
      email: 'ada.one@example.test',
    });
    const sameEmail = await person(a, { email: 'ada.one@example.test' });
    const colleague = await person(a, {
      given_name: 'Ada',
      family_name: 'Lovelace',
      email: 'ada.two@example.test',
    });
    const elsewhere = await person(a, {
      given_name: 'Ada',
      family_name: 'Lovelace',
      email: 'ada.three@example.test',
    });
    await link(a, subject, charity);
    await link(a, colleague, charity);

    const { events, found } = await candidates(a, subject);

    expect(found).toContainEqual({ partyId: sameEmail, signals: ['email'] });
    expect(found).toContainEqual({ partyId: colleague, signals: ['name_and_organisation'] });
    expect(found.map((c) => c.partyId)).not.toContain(elsewhere);
    expect(events).toEqual([{ read: true, action: 'party.person.viewed', entityId: subject }]);
  });

  it('has none for a merged or unknown party', async () => {
    const [loser, survivor] = [await org(a), await org(a)];
    await asMigratorIn(a.id, (client) =>
      client.query("UPDATE party.party SET status = 'merged', merged_into = $2 WHERE id = $1", [
        loser,
        survivor,
      ]),
    );

    expect((await candidates(a, loser)).found).toEqual([]);
    expect((await candidates(a, randomUUID())).found).toEqual([]);
  });

  it('never returns another tenant’s rows, whatever they share with this tenant’s', async () => {
    const shared = { name: 'Quayside Community Kitchen', address_postcode: 'QU1 1AY' };
    const mine = await org(a, shared);
    const theirs = await org(b, shared);
    await identifier(a, mine, 'GB-CHC', '1000041', memberA);
    await identifier(b, theirs, 'GB-CHC', '1000041');
    const myPerson = await person(a, {
      given_name: 'Sam',
      family_name: 'Reed',
      email: 'shared@example.test',
    });
    const theirPerson = await person(b, {
      given_name: 'Sam',
      family_name: 'Reed',
      email: 'shared@example.test',
    });

    const organisations = (await candidates(a, mine)).found;
    const people = (await candidates(a, myPerson)).found;

    expect(organisations.map((c) => c.partyId)).not.toContain(theirs);
    expect(people.map((c) => c.partyId)).not.toContain(theirPerson);
    expect((await candidates(a, theirs)).found).toEqual([]);
  });

  it('returns at most twenty, strongest first', async () => {
    const subject = await org(a, { name: 'Capped Candidate Trust' });
    for (let n = 0; n < 22; n += 1) await org(a, { name: 'Capped Candidate Trust' });

    expect((await candidates(a, subject)).found).toHaveLength(20);
  });
});
