// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Restore mode and app.reapply_erasure_ledger() (migrations 0048 and 0049,
// ADR 0027 and ADR 0011): outside restore mode a ledger row authorises
// nothing, no app role writes the mode or restores a row, and inside it
// re-apply erases the tenant's listed parties again, once, audited.

import { randomUUID } from 'node:crypto';

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { withClient } from '../connect.ts';
import { addErasureRequest, callAs, DESTROY, ERASE, erase, rowsOf } from '../erasure/fixtures.ts';
import { addPerson } from '../party/fixtures.ts';
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
import {
  addClassifiedApplication,
  CLASSIFIED_ANSWERS,
  inRestoreMode,
  ledgerRow,
} from './fixtures.ts';

const REAPPLY = 'SELECT app.reapply_erasure_ledger() AS counts';
const RESTORE_ROW = `SELECT app.restore_erasure_ledger_row($1, $2, $3, $4, $5, $6) AS restored`;
const REAPPLIED = 'platform.erasure_ledger.reapplied';

let tenant: TestTenant;
let other: TestTenant;

const reapply = (inTenant: TestTenant) => callAs('app_worker', inTenant, REAPPLY, []);
const counts = async (inTenant: TestTenant): Promise<Row> => {
  const { row, code } = await reapply(inTenant);
  expect(code).toBeUndefined();
  return row?.['counts'] as Row;
};
const statusOf = async (party: string, inTenant = tenant) =>
  (await rowsOf(inTenant, 'party.party', 'id', party))[0]?.['status'];
const eventsOf = (inTenant: TestTenant, action: string) =>
  asMigratorIn(inTenant.id, async (client) => {
    const { rows } = await client.query<Row>('SELECT * FROM app.audit_event WHERE action = $1', [
      action,
    ]);
    return rows;
  });

/** A person with one party_erased ledger row, as a dump taken before the erasure leaves them. */
function listedPerson(change: Row = {}, inTenant = tenant): Promise<string> {
  return asMigratorIn(inTenant.id, async (client) => {
    const party = await addPerson(client, inTenant, change);
    await ledgerRow(client, inTenant, party);
    return party;
  });
}

beforeAll(async () => {
  tenant = await createTestTenant();
  other = await createTestTenant();
}, 60_000);

describe('outside restore mode', { timeout: 30_000 }, () => {
  it('refuses re-apply, and an erasure or key destruction on a ledger row alone', async () => {
    const party = await listedPerson();
    await asMigratorIn(tenant.id, (client) =>
      ledgerRow(client, tenant, party, 'subject_key_destroyed'),
    );
    expect((await reapply(tenant)).code).toBe('42501');
    expect((await callAs('app_worker', tenant, ERASE, [party, null])).code).toBe('42501');
    expect((await callAs('app_worker', tenant, DESTROY, [party])).code).toBe('55000');
    expect(await statusOf(party)).toBe('active');
  });

  it('refuses a restored ledger row', async () => {
    const party = await asMigratorIn(tenant.id, (client) => addPerson(client, tenant));
    await asMigratorIn(tenant.id, async (client) => {
      expect(
        await outcome(client, RESTORE_ROW, [
          randomUUID(),
          party,
          'party_erased',
          null,
          randomUUID(),
          new Date(),
        ]),
      ).toBe('42501');
    });
    expect(await rowsOf(tenant, 'app.erasure_ledger', 'subject_party_id', party)).toEqual([]);
  });
});

describe('restore mode rights', { timeout: 30_000 }, () => {
  it('lets no app role write the mode, and app_api and app_worker read it', async () => {
    for (const role of ['app_api', 'app_worker', 'app_auth', 'app_queue'] as const) {
      await asRoleIn(role, tenant.id, async (client) => {
        expect(await outcome(client, 'UPDATE app.restore_mode SET active = true'), role).toBe(
          '42501',
        );
        expect(await outcome(client, 'INSERT INTO app.restore_mode DEFAULT VALUES'), role).toBe(
          '42501',
        );
        expect(await outcome(client, 'DELETE FROM app.restore_mode'), role).toBe('42501');
      });
    }
    for (const role of ['app_api', 'app_worker'] as const) {
      await asRoleIn(role, tenant.id, async (client) => {
        const { rows } = await client.query<Row>('SELECT active FROM app.restore_mode');
        expect(rows, role).toEqual([{ active: false }]);
      });
    }
  });

  it('lets only app_worker execute re-apply and only migrator restore a row', async () => {
    await inRestoreMode(async () => {
      for (const role of ['app_api', 'app_auth', 'app_queue'] as const) {
        expect((await callAs(role, tenant, REAPPLY, [])).code, role).toBe('42501');
      }
      for (const role of ['app_api', 'app_worker', 'app_auth', 'app_queue'] as const) {
        expect(
          (
            await callAs(role, tenant, RESTORE_ROW, [
              randomUUID(),
              randomUUID(),
              'party_erased',
              null,
              randomUUID(),
              new Date(),
            ])
          ).code,
          role,
        ).toBe('42501');
      }
      expect((await reapply(other)).code).toBeUndefined();
    });
  });
});

describe('re-apply in restore mode', { timeout: 30_000 }, () => {
  // Each test counts one tenant's ledger, so none sees another's leftovers.
  beforeEach(async () => {
    tenant = await createTestTenant();
  });

  it('erases a listed party again, once, and writes one event per call', async () => {
    const { application, person } = await asMigratorIn(tenant.id, async (client) => {
      const created = await addClassifiedApplication(client, tenant);
      await ledgerRow(client, tenant, created.person);
      return created;
    });

    await inRestoreMode(async () => {
      expect(await counts(tenant)).toMatchObject({ re_erased: 1, answers_cleared: 1, absent: 0 });

      expect(await statusOf(person)).toBe('erased');
      const [row] = await rowsOf(tenant, 'party.person', 'id', person);
      expect(row).toMatchObject({ given_name: null, family_name: null, phone: null });
      expect(row?.['email']).toBe(`${person}@erased.invalid`);
      const [saved] = await rowsOf(tenant, 'grants.application', 'id', application);
      expect(saved?.['answers']).toEqual({ f_org: CLASSIFIED_ANSWERS.f_org });

      expect(await counts(tenant)).toMatchObject({
        re_erased: 0,
        keys_destroyed: 0,
        answers_cleared: 0,
        memberships_removed: 0,
      });
      // The re-erasure records its own event, with no actor.
      const events = await rowsOf(tenant, 'app.audit_event', 'subject_party_id', person);
      expect(events.map((event) => event['actor_kind'])).toEqual(['system']);
    });
    expect(await eventsOf(tenant, REAPPLIED)).toHaveLength(2);
  });

  it('never touches another tenant', async () => {
    const party = await listedPerson();
    const theirs = await listedPerson({}, other);
    await inRestoreMode(async () => {
      await counts(tenant);
      expect(await statusOf(party)).toBe('erased');
      expect(await statusOf(theirs, other)).toBe('active');
      await counts(other);
      expect(await statusOf(theirs, other)).toBe('erased');
    });
  });

  it('removes a restored membership with its event, then erases the person', async () => {
    const userId = await createTestUser();
    const { party, member } = await asMigratorIn(tenant.id, async (client) => {
      await addMember(client, tenant); // Another admin remains.
      const created = await addPerson(client, tenant, { user_id: userId });
      await ledgerRow(client, tenant, created);
      const membership = await insertRow(client, 'app.membership', {
        tenant_id: tenant.id,
        user_id: userId,
        roles: ['tenant_admin'],
      });
      return { party: created, member: membership };
    });
    await inRestoreMode(async () => {
      expect(await counts(tenant)).toMatchObject({ memberships_removed: 1, re_erased: 1 });
    });
    const [membership] = await rowsOf(tenant, 'app.membership', 'id', member);
    expect(membership?.['status']).toBe('removed');
    const removed = await eventsOf(tenant, 'platform.membership.removed');
    expect(removed.filter((event) => event['entity_id'] === member)).toHaveLength(1);
    expect(await statusOf(party)).toBe('erased');
  });

  it('stops with ER001 when a removal would leave the tenant with no admin', async () => {
    const solo = await createTestTenant();
    const userId = await createTestUser();
    const party = await asMigratorIn(solo.id, async (client) => {
      await insertRow(client, 'app.membership', {
        tenant_id: solo.id,
        user_id: userId,
        roles: ['tenant_admin'],
      });
      const created = await addPerson(client, solo, { user_id: userId });
      await ledgerRow(client, solo, created);
      return created;
    });
    await inRestoreMode(async () => {
      expect((await reapply(solo)).code).toBe('ER001');
    });
    expect(await statusOf(party, solo)).toBe('active');
    expect(await eventsOf(solo, REAPPLIED)).toEqual([]);
  });

  it('counts an absent party and keeps its row', async () => {
    const absent = randomUUID();
    const ledgered = await asMigratorIn(tenant.id, (client) => ledgerRow(client, tenant, absent));
    await inRestoreMode(async () => {
      expect(await counts(tenant)).toMatchObject({ absent: 1 });
    });
    expect(await rowsOf(tenant, 'app.erasure_ledger', 'id', ledgered)).toHaveLength(1);
  });

  it('destroys a key on its ledger row, even with no erasure row', async () => {
    const party = await asMigratorIn(tenant.id, async (client) => {
      const created = await addPerson(client, tenant);
      await ledgerRow(client, tenant, created, 'subject_key_destroyed');
      return created;
    });
    await inRestoreMode(async () => {
      expect(await counts(tenant)).toMatchObject({ keys_destroyed: 1 });
    });
    expect((await rowsOf(tenant, 'app.subject_key', 'subject_party_id', party))[0]).toMatchObject({
      wrapped_key: null,
    });
  });

  it('restores a confirmed row once, with its audit event, for migrator alone', async () => {
    const party = await asMigratorIn(tenant.id, (client) => addPerson(client, tenant));
    const row = [randomUUID(), party, 'party_erased', null, randomUUID(), new Date()];
    await inRestoreMode(async () => {
      await withClient('migrator', async (client) => {
        await client.query('BEGIN');
        await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [tenant.id]);
        const { rows } = await client.query<Row>(RESTORE_ROW, row);
        expect(rows[0]).toEqual({ restored: true });
        expect((await client.query<Row>(RESTORE_ROW, row)).rows[0]).toEqual({ restored: false });
        await client.query('COMMIT');
      });
    });
    expect(await rowsOf(tenant, 'app.erasure_ledger', 'subject_party_id', party)).toHaveLength(1);
    const events = await eventsOf(tenant, 'platform.erasure_ledger.row_restored');
    expect(events.filter((event) => event['entity_id'] === row[0])).toHaveLength(1);
  });

  it('refuses a restored row dated in the future', async () => {
    const party = await asMigratorIn(tenant.id, (client) => addPerson(client, tenant));
    await inRestoreMode(async () => {
      await asRoleIn('migrator', tenant.id, async (client) => {
        expect(
          await outcome(client, RESTORE_ROW, [
            randomUUID(),
            party,
            'party_erased',
            null,
            randomUUID(),
            new Date(Date.now() + 3_600_000),
          ]),
        ).toBe('22023');
      });
    });
  });

  it('erases on a running erasure request as before, in restore mode too', async () => {
    const staff = await asMigratorIn(tenant.id, (client) => addMember(client, tenant));
    const { party, request } = await asMigratorIn(tenant.id, async (client) => {
      const created = await addPerson(client, tenant);
      return { party: created, request: await addErasureRequest(client, tenant, staff, created) };
    });
    await inRestoreMode(async () => {
      expect((await erase(tenant, party, request)).code).toBeUndefined();
    });
    const events = await rowsOf(tenant, 'app.audit_event', 'subject_party_id', party);
    expect(events[0]).toMatchObject({ actor_kind: 'user', actor_id: staff });
  });
});
