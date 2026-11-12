// SPDX-License-Identifier: AGPL-3.0-or-later
//
// assure.erase_subject (migration 0058, ADR 0027): only app_worker runs it,
// only for a party already erased in the transaction's tenant. It clears the
// person's linked officer names, the screened names of matches about them,
// the short text answers on their applications and their attendee rows, and
// for an organisation its snapshots' address and its visits' findings,
// follow-ups and captions. It keeps ids, codes and decisions, touches no
// namesake, and after a restore clears the restored rows again. The
// erasure guards then keep every such row as erasure left it.

import { beforeAll, describe, expect, it } from 'vitest';

import { addErasureRequest, callAs, erase } from '../erasure/fixtures.ts';
import { addApplication, addFile } from '../grants/application-fixtures.ts';
import {
  addMember,
  asMigratorIn,
  createTestTenant,
  insertRow,
  type Row,
  type TestTenant,
} from '../tenants.ts';
import {
  addChecklist,
  addList,
  addVisit,
  ANSWER_TEXT,
  FINDINGS,
  ITEM_ID,
  OFFICER_NAME,
  officerRow,
  responseRow,
  SCREENED_NAME,
  snapshotRow,
  visitRow,
  matchRow,
  runRow,
} from './fixtures.ts';

const ERASE_SUBJECT = 'SELECT assure.erase_subject($1) AS counts';
const OTHER_ANSWER = '1b9f3c1e-5d2a-4b7e-9c1f-2a3b4c5d6e7f';

let tenant: TestTenant;
let staff: string;
let person: string;
let organisation: string;
let ids: Record<string, string>;
let checklistMember: string;

const counts = (values: Partial<Record<string, number>> = {}) => ({
  'assure.lookup_officer': 0,
  'assure.screening_match': 0,
  'assure.lookup_snapshot': 0,
  'assure.checklist_response': 0,
  'assure.monitoring_visit': 0,
  'assure.visit_evidence': 0,
  'assure.visit_attendee': 0,
  ...values,
});

beforeAll(async () => {
  tenant = await createTestTenant();
  await asMigratorIn(tenant.id, async (client) => {
    staff = await addMember(client, tenant, ['programme_manager']);
    const { id: application, parts } = await addApplication(client, tenant);
    person = parts.person;
    organisation = parts.organisation;

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
    const list = await addList(client);
    const match = await insertRow(
      client,
      'assure.screening_match',
      matchRow(tenant, run, organisation, list, {
        name_source: 'officer',
        officer_id: linked,
        subject_party_id: person,
        entry_kind: 'individual',
      }),
    );
    const decision = await insertRow(client, 'assure.match_decision', {
      tenant_id: tenant.id,
      match_id: match,
      outcome: 'confirmed',
      reason_code: 'identity_confirmed',
      decided_by: staff,
    });

    const checklist = await addChecklist(client, tenant);
    checklistMember = checklist.member;
    const response = await insertRow(
      client,
      'assure.checklist_response',
      responseRow(tenant, application, checklist, {
        answers: JSON.stringify({
          [ITEM_ID]: { kind: 'short_text', value: ANSWER_TEXT },
          [OTHER_ANSWER]: { kind: 'yes_no', value: 'yes' },
        }),
      }),
    );

    const visit = await insertRow(
      client,
      'assure.monitoring_visit',
      visitRow(tenant, organisation, staff),
    );
    const evidence = await insertRow(client, 'assure.visit_evidence', {
      tenant_id: tenant.id,
      visit_id: visit,
      file_id: await addFile(client, tenant, staff),
      caption: 'Synthetic caption',
      added_by: staff,
    });
    const elsewhere = await addVisit(client, tenant);
    const attendee = await insertRow(client, 'assure.visit_attendee', {
      tenant_id: tenant.id,
      visit_id: elsewhere.visit,
      person_id: person,
    });
    ids = {
      snapshot,
      linked,
      namesake,
      match,
      decision,
      response,
      visit,
      evidence,
      attendee,
      kept: elsewhere.visit,
    };
  });
}, 60_000);

const eraseSubject = (party: string, inTenant: TestTenant | null = tenant) =>
  callAs('app_worker', inTenant ?? undefined, ERASE_SUBJECT, [party]);

/** One column of the row `id` of `table`, as migrator. */
function valueOf(table: string, column: string, id: string): Promise<unknown> {
  return asMigratorIn(tenant.id, async (client) => {
    const { rows } = await client.query<Row>(
      `SELECT ${column} AS value FROM ${table} WHERE id = $1`,
      [id],
    );
    return rows[0]?.['value'];
  });
}

/** Erase `party` with party.erase_party, as the erasure job does first. */
async function eraseParty(party: string) {
  const request = await asMigratorIn(tenant.id, (client) =>
    addErasureRequest(client, tenant, staff, party),
  );
  expect((await erase(tenant, party, request)).code).toBeUndefined();
}

/**
 * Put back what a restore from before the erasure would hold. A restore
 * brings back the rows, not the erasure guards' view of them, so the guards
 * are lifted inside this transaction.
 */
async function restorePreErasure() {
  const GUARDS = [
    'assure.lookup_officer DISABLE TRIGGER keep_erased',
    'assure.screening_match DISABLE TRIGGER keep_erased',
    'assure.checklist_response DISABLE TRIGGER keep_erased',
    'assure.visit_attendee DISABLE TRIGGER refuse_erased_party',
  ];
  await asMigratorIn(tenant.id, async (client) => {
    for (const guard of GUARDS) await client.query(`ALTER TABLE ${guard}`);
    await client.query('UPDATE assure.lookup_officer SET name = $2 WHERE id = $1', [
      ids['linked'],
      OFFICER_NAME,
    ]);
    await client.query('UPDATE assure.screening_match SET screened_name = $2 WHERE id = $1', [
      ids['match'],
      SCREENED_NAME,
    ]);
    await client.query('UPDATE assure.checklist_response SET answers = $2 WHERE id = $1', [
      ids['response'],
      JSON.stringify({ [ITEM_ID]: { kind: 'short_text', value: ANSWER_TEXT } }),
    ]);
    await insertRow(client, 'assure.visit_attendee', {
      tenant_id: tenant.id,
      visit_id: ids['kept'],
      person_id: person,
    });
    for (const guard of GUARDS) {
      await client.query(`ALTER TABLE ${guard.replace('DISABLE', 'ENABLE')}`);
    }
  });
}

describe('assure.erase_subject', { timeout: 60_000 }, () => {
  it('runs only for app_worker, only for an erased party of the tenant', async () => {
    expect((await callAs('app_api', tenant, ERASE_SUBJECT, [person])).code).toBe('42501');
    expect((await eraseSubject(person)).code).toBe('55000');
    expect((await eraseSubject(person, null)).code).toBe('55000');
    expect(await valueOf('assure.lookup_officer', 'name', ids['linked'] ?? '')).toBe(OFFICER_NAME);
  });

  it("clears a person's names, text answers and attendance, and keeps the rest", async () => {
    await eraseParty(person);
    expect((await eraseSubject(person, await createTestTenant())).code).toBe('55000');
    const { row, code } = await eraseSubject(person);
    expect(code).toBeUndefined();
    expect(row?.['counts']).toEqual(
      counts({
        'assure.lookup_officer': 1,
        'assure.screening_match': 1,
        'assure.checklist_response': 1,
        'assure.visit_attendee': 1,
      }),
    );
    expect(await valueOf('assure.lookup_officer', 'name', ids['linked'] ?? '')).toBe('erased');
    expect(await valueOf('assure.lookup_officer', 'name', ids['namesake'] ?? '')).toBe(
      OFFICER_NAME,
    );
    expect(await valueOf('assure.lookup_officer', 'person_id', ids['linked'] ?? '')).toBe(person);
    expect(await valueOf('assure.screening_match', 'screened_name', ids['match'] ?? '')).toBe(
      'erased',
    );
    expect(await valueOf('assure.screening_match', 'designation_id', ids['match'] ?? '')).toBe(
      'TST0001',
    );
    expect(await valueOf('assure.match_decision', 'outcome', ids['decision'] ?? '')).toBe(
      'confirmed',
    );
    expect(await valueOf('assure.checklist_response', 'answers', ids['response'] ?? '')).toEqual({
      [ITEM_ID]: { kind: 'short_text', value: 'erased' },
      [OTHER_ANSWER]: { kind: 'yes_no', value: 'yes' },
    });
    expect(await valueOf('assure.visit_attendee', 'id', ids['attendee'] ?? '')).toBeUndefined();
    expect(await valueOf('assure.monitoring_visit', 'findings', ids['visit'] ?? '')).toBe(FINDINGS);
    expect((await eraseSubject(person)).row?.['counts']).toEqual(counts());
  });

  it("clears an organisation's address, findings, follow-ups and captions", async () => {
    await eraseParty(organisation);
    expect((await eraseSubject(organisation)).row?.['counts']).toEqual(
      counts({
        'assure.lookup_snapshot': 1,
        'assure.monitoring_visit': 1,
        'assure.visit_evidence': 1,
      }),
    );
    expect(
      await valueOf('assure.lookup_snapshot', 'address_line1', ids['snapshot'] ?? ''),
    ).toBeNull();
    expect(await valueOf('assure.lookup_snapshot', 'registered_name', ids['snapshot'] ?? '')).toBe(
      'Synthetic Charity',
    );
    expect(await valueOf('assure.monitoring_visit', 'findings', ids['visit'] ?? '')).toBe('erased');
    expect(await valueOf('assure.monitoring_visit', 'follow_ups', ids['visit'] ?? '')).toEqual([]);
    expect(await valueOf('assure.visit_evidence', 'caption', ids['evidence'] ?? '')).toBe('erased');
  });

  it('refuses new rows naming an erased party', async () => {
    const outcomeOf = (table: string, values: Row) =>
      callAs(
        'app_api',
        tenant,
        `INSERT INTO ${table} (${Object.keys(values).join(', ')})
        VALUES (${Object.keys(values)
          .map((_, index) => `$${String(index + 1)}`)
          .join(', ')})`,
        Object.values(values),
      );
    expect(
      (
        await outcomeOf('assure.visit_attendee', {
          tenant_id: tenant.id,
          visit_id: ids['kept'],
          person_id: person,
        })
      ).code,
    ).toBe('55000');
    expect(
      (await outcomeOf('assure.monitoring_visit', visitRow(tenant, organisation, staff))).code,
    ).toBe('55000');
  });

  it("keeps an erased party's rows as erasure left them, for every role", async () => {
    const files = await asMigratorIn(tenant.id, async (client) => [
      await addFile(client, tenant, staff),
      await addFile(client, tenant, staff),
    ]);
    const refused = async (role: 'app_api' | 'migrator', text: string, values: unknown[]) => {
      expect((await callAs(role, tenant, text, values)).code, text).toBe('55000');
    };
    await refused('app_api', "UPDATE assure.monitoring_visit SET findings = 'New' WHERE id = $1", [
      ids['visit'],
    ]);
    await refused('app_api', "UPDATE assure.visit_evidence SET caption = 'New' WHERE id = $1", [
      ids['evidence'],
    ]);
    await refused('app_api', 'UPDATE assure.checklist_response SET answers = $2 WHERE id = $1', [
      ids['response'],
      JSON.stringify({ [ITEM_ID]: { kind: 'short_text', value: 'New' } }),
    ]);
    await refused(
      'app_api',
      `INSERT INTO assure.visit_evidence (tenant_id, visit_id, file_id, caption, added_by)
       VALUES ($1, $2, $3, 'New', $4)`,
      [tenant.id, ids['visit'], files[0], staff],
    );
    await refused(
      'app_api',
      `INSERT INTO assure.checklist_response_file (tenant_id, response_id, item_id, file_id, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [tenant.id, ids['response'], ITEM_ID, files[1], checklistMember],
    );
    await refused('migrator', "UPDATE assure.lookup_officer SET name = 'New' WHERE id = $1", [
      ids['linked'],
    ]);
    await refused(
      'migrator',
      "UPDATE assure.screening_match SET screened_name = 'New' WHERE id = $1",
      [ids['match']],
    );
    await refused(
      'migrator',
      `UPDATE assure.lookup_snapshot SET address_line1 = 'New', address_town = 'New',
         address_postcode = 'ZZ1 1ZZ', address_country_code = 'GB' WHERE id = $1`,
      [ids['snapshot']],
    );
    expect(await valueOf('assure.lookup_officer', 'name', ids['namesake'] ?? '')).toBe(
      OFFICER_NAME,
    );
  });

  it('clears the pre-erasure rows again after a restore', async () => {
    await restorePreErasure();
    expect((await eraseSubject(person)).row?.['counts']).toEqual(
      counts({
        'assure.lookup_officer': 1,
        'assure.screening_match': 1,
        'assure.checklist_response': 1,
        'assure.visit_attendee': 1,
      }),
    );
    expect(await valueOf('assure.lookup_officer', 'name', ids['linked'] ?? '')).toBe('erased');
    expect(await valueOf('assure.screening_match', 'screened_name', ids['match'] ?? '')).toBe(
      'erased',
    );
  });
});
