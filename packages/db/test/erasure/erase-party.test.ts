// SPDX-License-Identifier: AGPL-3.0-or-later
//
// party.erase_party() (migration 0033, ADR 0027): only app_worker may call
// it, in a tenant, under a running erasure request of that tenant for the
// party or its merge set. It clears a person's or an organisation's personal
// columns, the snapshots' and the value history's, marks the party erased
// and writes one event, deleting nothing: applications, consents and audit
// events still point at the party, unchanged. A refused call changes
// nothing and writes no event, and erasing again changes nothing.

import { randomUUID } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import { applicationRow, addParts } from '../grants/application-fixtures.ts';
import { addOrganisation, addPerson } from '../party/fixtures.ts';
import { addSnapshot } from '../party-snapshot/fixtures.ts';
import {
  addMember,
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  createTestUser,
  insertRow,
  outcome,
  type Row,
  type TestTenant,
} from '../tenants.ts';
import { addErasureRequest, callAs, ERASE, erase, rowsOf } from './fixtures.ts';

const PERSONAL = ['Ada', 'Lovelace', '7946'];

let tenant: TestTenant;
let other: TestTenant;
let staff: string;
let person: string;
let email: string;
let application: string;
let request: string;
let member: string;
let memberRequest: string;
const refused: Record<string, string> = {};

/** A history row for `party`'s `field`, changed by `actor`. */
const history = (party: string, kind: string, field: string, actor: string): Row => ({
  tenant_id: tenant.id,
  party_id: party,
  party_kind: kind,
  field_id: field,
  old_value: 'Ada',
  new_value: 'Adeline',
  changed_by: actor,
});

beforeAll(async () => {
  tenant = await createTestTenant();
  other = await createTestTenant();
  const account = await createTestUser();
  const memberAccount = await createTestUser();
  email = `${randomUUID()}@example.test`;
  await asMigratorIn(tenant.id, async (client) => {
    staff = await addMember(client, tenant);
    const applicant = await insertRow(client, 'app.membership', {
      tenant_id: tenant.id,
      user_id: account,
      roles: ['applicant'],
    });
    await client.query("UPDATE app.membership SET status = 'removed' WHERE id = $1", [applicant]);
    person = await addPerson(client, tenant, {
      given_name: 'Ada',
      family_name: 'Lovelace',
      email,
      phone: '+44 20 7946 0000',
      user_id: account,
    });
    const parts = await addParts(client, tenant);
    application = await insertRow(
      client,
      'grants.application',
      applicationRow(tenant, { ...parts, person }),
    );
    await insertRow(
      client,
      'party.value_history',
      history(person, 'person', 'person.given_name', staff),
    );
    await insertRow(client, 'party.consent', {
      tenant_id: tenant.id,
      person_id: person,
      purpose: 'future_funding',
      channel: 'email',
      state: 'given',
      privacy_notice_version: 'v1',
      source: 'portal',
      recorded_by: staff,
    });
    for (let index = 0; index < 2; index += 1) {
      await insertRow(client, 'app.audit_event', {
        tenant_id: tenant.id,
        request_id: randomUUID(),
        actor_kind: 'user',
        actor_id: staff,
        action: 'party.person.updated',
        entity_type: 'party.person',
        entity_id: person,
        subject_party_id: person,
        changes: JSON.stringify({ fields: ['person.given_name'] }),
      });
    }
    request = await addErasureRequest(client, tenant, staff, person);

    const stranger = await addPerson(client, tenant);
    refused['another party'] = await addErasureRequest(client, tenant, staff, stranger);
    refused['another reason'] = await addErasureRequest(client, tenant, staff, person, {
      filters: JSON.stringify({ partyId: person, reason: 'tidy_up' }),
    });
    refused['another kind'] = await addErasureRequest(client, tenant, staff, person, {
      kind: 'subject_access',
    });
    refused['a queued request'] = await insertRow(client, 'app.job_request', {
      tenant_id: tenant.id,
      kind: 'erasure',
      requested_by: staff,
      permission: 'platform.erasure.request',
      filters: JSON.stringify({ partyId: person, reason: 'subject_request' }),
      field_ids: ['party.person.email'],
      output_sensitivity: 'personal',
      request_id: randomUUID(),
    });
    refused['no request'] = randomUUID();

    member = await addPerson(client, tenant, { user_id: memberAccount });
    await insertRow(client, 'app.membership', {
      tenant_id: tenant.id,
      user_id: memberAccount,
      roles: ['applicant'],
    });
    memberRequest = await addErasureRequest(client, tenant, staff, member);
  });
  refused['a request of another tenant'] = await asMigratorIn(other.id, async (client) =>
    addErasureRequest(client, other, await addMember(client, other), person),
  );
}, 60_000);

const personRow = () => rowsOf(tenant, 'party.person', 'id', person);
const events = () => rowsOf(tenant, 'app.audit_event', 'subject_party_id', person);

describe('party.erase_party refusals', { timeout: 30_000 }, () => {
  it.each(['app_api', 'app_auth', 'app_queue'] as const)('cannot be called by %s', async (role) => {
    expect((await callAs(role, tenant, ERASE, [person, request])).code).toBe('42501');
  });

  it('needs a tenant', async () => {
    expect((await callAs('app_worker', undefined, ERASE, [person, request])).code).toBe('55000');
  });

  it('cannot erase another tenant’s party', async () => {
    expect((await erase(other, person, request)).code).toBe('42501');
  });

  it.each(Object.keys(refused))('refuses %s, changing nothing', async (name) => {
    const [before, eventsBefore] = [await personRow(), await events()];
    expect((await erase(tenant, person, refused[name] ?? '')).code).toBe('42501');
    expect(await personRow()).toEqual(before);
    expect(await events()).toEqual(eventsBefore);
  });

  it('refuses a person whose account is still a member of the tenant', async () => {
    const before = await rowsOf(tenant, 'party.person', 'id', member);
    expect((await erase(tenant, member, memberRequest)).code).toBe('55000');
    expect(await rowsOf(tenant, 'party.person', 'id', member)).toEqual(before);
  });

  it('lets no role mark an uncleared party erased, nor an app role a cleared one', async () => {
    const mark = "UPDATE party.party SET status = 'erased' WHERE id = $1";
    await asRoleIn('migrator', tenant.id, async (client) => {
      expect(await outcome(client, mark, [person])).toBe('23514');
    });
    const organisation = await asMigratorIn(tenant.id, (client) => addOrganisation(client, tenant));
    await asRoleIn('app_api', tenant.id, async (client) => {
      expect(await outcome(client, mark, [organisation])).toBe('23514');
      await client.query(
        `UPDATE party.organisation SET address_line1 = 'erased', address_line2 = NULL,
                address_town = 'erased', address_postcode = 'erased', address_country_code = 'ZZ'
          WHERE id = $1`,
        [organisation],
      );
      expect(await outcome(client, mark, [organisation])).toBe('42501');
    });
  });
});

describe('party.erase_party on a person', { timeout: 30_000 }, () => {
  it('clears the person, keeps every reference, and audits it once', async () => {
    const eventsBefore = await events();
    const consents = await rowsOf(tenant, 'party.consent', 'person_id', person);

    expect((await erase(tenant, person, request)).row?.counts).toEqual({
      'party.party': 1,
      'party.person': 1,
      'party.organisation': 0,
      'party.organisation_snapshot': 0,
      'party.value_history': 1,
    });

    expect(await personRow()).toMatchObject([
      {
        given_name: null,
        family_name: null,
        phone: null,
        user_id: null,
        email: `${person}@erased.invalid`,
      },
    ]);
    const [party] = await rowsOf(tenant, 'party.party', 'id', person);
    expect(party).toMatchObject({ status: 'erased', erased_at: expect.any(Date) as Date });
    expect(await rowsOf(tenant, 'party.value_history', 'party_id', person)).toMatchObject([
      { field_id: 'person.given_name', old_value: null, new_value: null, changed_by: staff },
    ]);
    expect(await rowsOf(tenant, 'party.consent', 'person_id', person)).toEqual(consents);
    expect(await rowsOf(tenant, 'grants.application', 'id', application)).toMatchObject([
      { applicant_person_id: person },
    ]);

    const eventsAfter = await events();
    expect(eventsAfter.filter((event) => event.action !== 'party.party.erased')).toEqual(
      eventsBefore,
    );
    expect(eventsAfter.filter((event) => event.action === 'party.party.erased')).toMatchObject([
      {
        actor_kind: 'user',
        actor_id: staff,
        entity_type: 'party.party',
        entity_id: person,
        changes: { reason: 'subject_request', counts: { 'party.person': 1 } },
      },
    ]);
  });

  it.each(['app_api', 'app_worker'] as const)(
    'leaves %s nothing personal to read',
    async (role) => {
      await asRoleIn(role, tenant.id, async (client) => {
        const { rows } = await client.query('SELECT * FROM party.person WHERE id = $1', [person]);
        const seen = JSON.stringify(rows);
        for (const value of [...PERSONAL, email]) expect(seen).not.toContain(value);
      });
      await asRoleIn(role, tenant.id, async (client) => {
        const { rows } = await client.query(
          'SELECT old_value, new_value FROM party.value_history WHERE party_id = $1',
          [person],
        );
        expect(rows).toEqual([{ old_value: null, new_value: null }]);
      });
    },
  );

  it('changes nothing and writes no event when erased again', async () => {
    const [before, eventsBefore] = [await personRow(), await events()];
    expect((await erase(tenant, person, request)).row?.counts).toEqual({
      'party.party': 0,
      'party.person': 0,
      'party.organisation': 0,
      'party.organisation_snapshot': 0,
      'party.value_history': 0,
    });
    expect(await personRow()).toEqual(before);
    expect(await events()).toEqual(eventsBefore);
  });

  it('is final: no role changes an erased party', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const { rowCount } = await client.query(
        "UPDATE party.party SET status = 'active' WHERE id = $1",
        [person],
      );
      expect(rowCount).toBe(0);
    });
    await asRoleIn('migrator', tenant.id, async (client) => {
      const reopen = "UPDATE party.party SET status = 'active', erased_at = NULL WHERE id = $1";
      expect(await outcome(client, reopen, [person])).toBe('55000');
    });
  });
});

describe('party.erase_party on an organisation', { timeout: 30_000 }, () => {
  it('clears its address and its snapshots’ and keeps the rest', async () => {
    const { organisation, snapshot, organisationRequest } = await asMigratorIn(
      tenant.id,
      async (client) => {
        const id = await addOrganisation(client, tenant);
        await insertRow(client, 'party.value_history', {
          ...history(id, 'organisation', 'organisation.address_line1', staff),
          old_value: '1 High Street',
          new_value: '2 High Street',
        });
        await insertRow(client, 'party.value_history', {
          ...history(id, 'organisation', 'organisation.name', staff),
          old_value: 'Old name',
          new_value: 'New name',
        });
        return {
          organisation: id,
          snapshot: await addSnapshot(client, id, staff),
          organisationRequest: await addErasureRequest(client, tenant, staff, id),
        };
      },
    );

    expect((await erase(tenant, organisation, organisationRequest)).row?.counts).toEqual({
      'party.party': 1,
      'party.person': 0,
      'party.organisation': 1,
      'party.organisation_snapshot': 1,
      'party.value_history': 1,
    });
    const erased = {
      address_line1: 'erased',
      address_line2: null,
      address_town: 'erased',
      address_postcode: 'erased',
      address_country_code: 'ZZ',
    };
    const name = 'Northfield Allotment Society';
    expect(await rowsOf(tenant, 'party.organisation', 'id', organisation)).toMatchObject([
      { ...erased, name },
    ]);
    expect(await rowsOf(tenant, 'party.organisation_snapshot', 'id', snapshot)).toMatchObject([
      { ...erased, name },
    ]);
    const kept = await rowsOf(tenant, 'party.value_history', 'party_id', organisation);
    expect(kept.map(({ field_id, old_value }) => ({ field_id, old_value }))).toEqual(
      expect.arrayContaining([
        { field_id: 'organisation.address_line1', old_value: null },
        { field_id: 'organisation.name', old_value: 'Old name' },
      ]),
    );
  });
});

describe('party.erase_party on a merge set', { timeout: 30_000 }, () => {
  it('erases each party under a request for the survivor, keeping the loser’s survivor', async () => {
    const { loser, survivor, survivorRequest } = await asMigratorIn(tenant.id, async (client) => {
      const [first, second] = [await addPerson(client, tenant), await addPerson(client, tenant)];
      await client.query(
        "UPDATE party.party SET status = 'merged', merged_into = $2 WHERE id = $1",
        [first, second],
      );
      return {
        loser: first,
        survivor: second,
        survivorRequest: await addErasureRequest(client, tenant, staff, second),
      };
    });
    expect((await erase(tenant, loser, survivorRequest)).code).toBeUndefined();
    expect((await erase(tenant, survivor, survivorRequest)).code).toBeUndefined();
    expect(await rowsOf(tenant, 'party.party', 'id', loser)).toMatchObject([
      { status: 'erased', merged_into: survivor },
    ]);
    expect(await rowsOf(tenant, 'party.party', 'id', survivor)).toMatchObject([
      { status: 'erased', merged_into: null },
    ]);
  });
});
