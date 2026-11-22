// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Assure's contributions to subject access and erasure against the test
// database, as app_worker in a tenant's transaction (ADR 0027, ADR 0031):
// the subject's rows in every assure table with the classes the map gives
// them, and erasure through assure.erase_subject() once the party is erased.
// Neither depends on the tenant having assure switched on (these tenants
// have no switch row), and no other tenant's rows are read or changed.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../../../../packages/db/src/database.ts';
import { trustedTenantId, withTenant } from '../../../../packages/db/src/tenant-context.ts';
import { databaseSettings } from '../../../../packages/db/test/connect.ts';
import { addErasureRequest, erase } from '../../../../packages/db/test/erasure/fixtures.ts';
import {
  addChecklist,
  addList,
  addVisit,
  ANSWER_TEXT,
  ITEM_ID,
  matchRow,
  OFFICER_NAME,
  officerRow,
  responseRow,
  runRow,
  snapshotRow,
  visitRow,
} from '../../../../packages/db/test/assure/fixtures.ts';
import {
  addApplication,
  addFile,
} from '../../../../packages/db/test/grants/application-fixtures.ts';
import {
  addMember,
  asMigratorIn,
  createTestTenant,
  insertRow,
  type TestTenant,
} from '../../../../packages/db/test/tenants.ts';
import { assureErasure } from './erasure.ts';
import type { Tx } from './registries/store.ts';
import { assureSubjectData, subjectTables } from './subject-data.ts';

interface Fixture {
  readonly tenant: TestTenant;
  readonly staff: string;
  readonly person: string;
  readonly organisation: string;
  readonly linked: string;
  readonly namesake: string;
  readonly match: string;
}

let worker: ReturnType<typeof createDatabase<unknown>>;
let a: Fixture;
let b: Fixture;

async function addFixture(): Promise<Fixture> {
  const tenant = await createTestTenant();
  return asMigratorIn(tenant.id, async (client) => {
    const staff = await addMember(client, tenant, ['programme_manager']);
    const { id: application, parts } = await addApplication(client, tenant);
    const { person, organisation } = parts;
    const snapshot = await insertRow(
      client,
      'assure.lookup_snapshot',
      snapshotRow(tenant, organisation),
    );
    const linked = await insertRow(client, 'assure.lookup_officer', officerRow(tenant, snapshot));
    await client.query(
      'UPDATE assure.lookup_officer SET person_id = $2, linked_by = $3 WHERE id = $1',
      [linked, person, staff],
    );
    const namesake = await insertRow(client, 'assure.lookup_officer', officerRow(tenant, snapshot));
    const run = await insertRow(client, 'assure.screening_run', runRow(tenant, organisation));
    const match = await insertRow(
      client,
      'assure.screening_match',
      matchRow(tenant, run, organisation, await addList(client), {
        name_source: 'officer',
        officer_id: linked,
        subject_party_id: person,
        entry_kind: 'individual',
      }),
    );
    await insertRow(client, 'assure.match_decision', {
      tenant_id: tenant.id,
      match_id: match,
      outcome: 'confirmed',
      reason_code: 'identity_confirmed',
      decided_by: staff,
    });
    const checklist = await addChecklist(client, tenant);
    await insertRow(
      client,
      'assure.checklist_response',
      responseRow(tenant, application, checklist),
    );
    const visit = await insertRow(
      client,
      'assure.monitoring_visit',
      visitRow(tenant, organisation, staff),
    );
    await insertRow(client, 'assure.visit_evidence', {
      tenant_id: tenant.id,
      visit_id: visit,
      file_id: await addFile(client, tenant, staff),
      caption: 'Synthetic caption',
      added_by: staff,
    });
    const elsewhere = await addVisit(client, tenant);
    await insertRow(client, 'assure.visit_attendee', {
      tenant_id: tenant.id,
      visit_id: elsewhere.visit,
      person_id: person,
    });
    return { tenant, staff, person, organisation, linked, namesake, match };
  });
}

beforeAll(async () => {
  const { host, port, database, password } = databaseSettings('app_worker', 4);
  worker = createDatabase<unknown>({
    host,
    port,
    database,
    password,
    role: 'app_worker',
    maxConnections: 4,
    applicationName: 'tps-db-tests',
  });
  [a, b] = [await addFixture(), await addFixture()];
}, 60_000);

afterAll(() => worker.destroy());

const inTenant = <T>(fixture: Fixture, work: (tx: Tx) => Promise<T>) =>
  withTenant(worker, trustedTenantId(fixture.tenant.id), work);

const subjectData = (fixture: Fixture, party: string) =>
  inTenant(fixture, (tx) => assureSubjectData.subjectData(tx, party));

const subjectsOf = (party: string) => [
  { partyId: party, givenName: null, familyName: null, email: null, accountId: null },
];

const officerName = (fixture: Fixture, id: string) =>
  asMigratorIn(fixture.tenant.id, async (client) => {
    const { rows } = await client.query<{ name: string }>(
      'SELECT name FROM assure.lookup_officer WHERE id = $1',
      [id],
    );
    return rows[0]?.name;
  });

describe('assure subject data', () => {
  it("lists a person's rows with their classes, and not a namesake's", async () => {
    const data = await subjectData(a, a.person);
    expect(Object.keys(data).sort()).toEqual(Object.keys(subjectTables).sort());
    const rows = (table: string) => data[table] ?? [];
    expect(rows('assure.lookup_officer')).toHaveLength(1);
    expect(rows('assure.lookup_officer')[0]?.['assure.lookup_officer.name']).toEqual({
      value: OFFICER_NAME,
      sensitivity: 'personal',
    });
    expect(rows('assure.screening_match')).toHaveLength(1);
    expect(rows('assure.match_decision')).toHaveLength(1);
    expect(rows('assure.checklist_response')).toHaveLength(1);
    expect(rows('assure.checklist_response')[0]?.['assure.checklist_response.answers']).toEqual({
      value: { [ITEM_ID]: { kind: 'short_text', value: ANSWER_TEXT } },
      sensitivity: 'personal',
    });
    expect(rows('assure.visit_attendee')).toHaveLength(1);
    expect(rows('assure.lookup_snapshot')).toEqual([]);
  });

  it("lists an organisation's snapshots, runs and visits, dates as their own day", async () => {
    const data = await subjectData(a, a.organisation);
    expect(data['assure.lookup_snapshot']).toHaveLength(1);
    expect(data['assure.lookup_snapshot']?.[0]?.['assure.lookup_snapshot.address_line1']).toEqual({
      value: '1 Synthetic Street',
      sensitivity: 'personal',
    });
    expect(data['assure.screening_run']).toHaveLength(1);
    expect(data['assure.monitoring_visit']?.[0]?.['assure.monitoring_visit.visited_on']).toEqual({
      value: '2026-11-02',
      sensitivity: 'internal',
    });
    expect(data['assure.visit_evidence']).toHaveLength(1);
    expect(data['assure.lookup_officer']).toEqual([]);
  });

  it("reads nothing of another tenant's party", async () => {
    for (const data of [await subjectData(a, b.person), await subjectData(b, a.organisation)]) {
      expect(Object.values(data).flat()).toEqual([]);
    }
  });
});

describe('assure erasure', { timeout: 60_000 }, () => {
  const eraseParty = async (fixture: Fixture, party: string) => {
    const request = await asMigratorIn(fixture.tenant.id, (client) =>
      addErasureRequest(client, fixture.tenant, fixture.staff, party),
    );
    expect((await erase(fixture.tenant, party, request)).code).toBeUndefined();
  };

  it('refuses until the party is erased', async () => {
    await expect(
      inTenant(a, (tx) => assureErasure.erase(tx, subjectsOf(a.person))),
    ).rejects.toThrow();
    expect(await officerName(a, a.linked)).toBe(OFFICER_NAME);
  });

  it("clears the person's linked names, answers and attendance, and no namesake or other tenant", async () => {
    await eraseParty(a, a.person);
    const counts = await inTenant(a, (tx) => assureErasure.erase(tx, subjectsOf(a.person)));
    expect(counts).toMatchObject({
      'assure.lookup_officer': 1,
      'assure.screening_match': 1,
      'assure.checklist_response': 1,
      'assure.visit_attendee': 1,
    });
    expect(await officerName(a, a.linked)).toBe('erased');
    expect(await officerName(a, a.namesake)).toBe(OFFICER_NAME);
    expect(await officerName(b, b.linked)).toBe(OFFICER_NAME);
    const again = await inTenant(a, (tx) => assureErasure.erase(tx, subjectsOf(a.person)));
    expect(Object.values(again).every((count) => count === 0)).toBe(true);
  });

  it('clears the name again when a restore from before the erasure is applied', async () => {
    await asMigratorIn(a.tenant.id, async (client) => {
      await client.query('ALTER TABLE assure.lookup_officer DISABLE TRIGGER keep_erased');
      await client.query('UPDATE assure.lookup_officer SET name = $2 WHERE id = $1', [
        a.linked,
        OFFICER_NAME,
      ]);
      await client.query('ALTER TABLE assure.lookup_officer ENABLE TRIGGER keep_erased');
    });
    expect(await officerName(a, a.linked)).toBe(OFFICER_NAME);
    const counts = await inTenant(a, (tx) => assureErasure.erase(tx, subjectsOf(a.person)));
    expect(counts).toMatchObject({ 'assure.lookup_officer': 1 });
    expect(await officerName(a, a.linked)).toBe('erased');
  });

  it("clears an organisation's snapshot address, and only this tenant's", async () => {
    await eraseParty(a, a.organisation);
    const counts = await inTenant(a, (tx) => assureErasure.erase(tx, subjectsOf(a.organisation)));
    expect(counts).toMatchObject({ 'assure.lookup_snapshot': 1, 'assure.monitoring_visit': 1 });
    const rows = await asMigratorIn(b.tenant.id, async (client) => {
      const { rows: found } = await client.query<{ address_line1: string | null }>(
        'SELECT address_line1 FROM assure.lookup_snapshot',
      );
      return found;
    });
    expect(rows.every((row) => row.address_line1 !== null)).toBe(true);
  });
});
