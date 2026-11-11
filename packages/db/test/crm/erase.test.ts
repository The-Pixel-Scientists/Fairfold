// SPDX-License-Identifier: AGPL-3.0-or-later
//
// crm.erase_subject (migration 0063, ADR 0027): only app_worker runs it, only
// for a party already erased in the transaction's tenant; it clears the
// party's interaction summaries, the cells of import rows that created or
// matched it and its external ids and URLs, keeps ids and times, deletes
// nothing and, called again after a restore, clears the restored rows. Once
// a party is erased, nothing writes a new personal value about it.

import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import { addErasureRequest, callAs, erase } from '../erasure/fixtures.ts';
import { addPerson } from '../party/fixtures.ts';
import {
  asMigratorIn,
  createTestTenant,
  insertRow,
  outcome,
  type Row,
  type TestTenant,
} from '../tenants.ts';
import {
  addCrmParts,
  addImportJob,
  importRowRow,
  insertOutcome,
  noteRow,
  referenceRow,
  SUMMARY,
  type CrmParts,
} from './fixtures.ts';

const ERASE_CRM = 'SELECT crm.erase_subject($1) AS counts';
const CELLS = { given_name: 'Ada', family_name: 'Example', email: 'ada@example.test' };
const ADDRESS = 'https://crm.example.test/records/1';
const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : 1);

let tenant: TestTenant;
let parts: CrmParts;
let live: string;
let note: string;
let keptNote: string;
let created: string;
let matched: string;
let keptRow: string;
let reference: string;
let externalId: string;

beforeAll(async () => {
  tenant = await createTestTenant();
  await asMigratorIn(tenant.id, async (client) => {
    parts = await addCrmParts(client, tenant);
    live = await addPerson(client, tenant);
    note = await insertRow(client, 'crm.interaction', noteRow(tenant, parts.person, parts.member));
    keptNote = await insertRow(client, 'crm.interaction', noteRow(tenant, live, parts.member));
    const job = await addImportJob(client, tenant, parts.member);
    const row = (number: number, change: Row) =>
      insertRow(
        client,
        'crm.import_row',
        importRowRow(tenant, job, { row_number: number, ...change }),
      );
    created = await row(2, { created_party_id: parts.person });
    matched = await row(3, { duplicate_party_id: parts.person });
    keptRow = await row(4, { created_party_id: live });
    const referenceValues = referenceRow(tenant, parts.person, parts.member);
    externalId = String(referenceValues['external_id']);
    reference = await insertRow(client, 'crm.external_reference', referenceValues);
  });
}, 60_000);

const clearCrm = (inTenant: TestTenant | null = tenant) =>
  callAs('app_worker', inTenant ?? undefined, ERASE_CRM, [parts.person]);

async function state(): Promise<Row> {
  return asMigratorIn(tenant.id, async (client) => {
    const one = async (text: string, values: unknown[]) =>
      (await client.query<Row>(text, values)).rows;
    return {
      summaries: await one(
        'SELECT id, summary FROM crm.interaction WHERE id = ANY ($1) ORDER BY id',
        [[note, keptNote].sort()],
      ),
      cells: await one('SELECT id, cells FROM crm.import_row WHERE id = ANY ($1) ORDER BY id', [
        [created, matched, keptRow].sort(),
      ]),
      references: await one(
        'SELECT id, party_id, external_id, url FROM crm.external_reference WHERE id = $1',
        [reference],
      ),
    };
  });
}

const cleared = () => ({
  summaries: [
    { id: note, summary: 'erased' },
    { id: keptNote, summary: SUMMARY },
  ].sort(byId),
  cells: [
    { id: created, cells: {} },
    { id: matched, cells: {} },
    { id: keptRow, cells: CELLS },
  ].sort(byId),
  references: [
    { id: reference, party_id: parts.person, external_id: `erased:${reference}`, url: null },
  ],
});

/** Put the pre-erasure values back, as a restore from backup would, past the guards. */
async function restorePreErasure() {
  await asMigratorIn(tenant.id, async (client: pg.ClientBase) => {
    await client.query('ALTER TABLE crm.interaction DISABLE TRIGGER refuse_erased_value');
    await client.query('ALTER TABLE crm.external_reference DISABLE TRIGGER refuse_erased_value');
    await client.query('UPDATE crm.interaction SET summary = $1 WHERE id = $2', [SUMMARY, note]);
    await client.query('UPDATE crm.import_row SET cells = $1 WHERE id = ANY ($2)', [
      JSON.stringify(CELLS),
      [created, matched],
    ]);
    await client.query(
      'UPDATE crm.external_reference SET external_id = $1, url = $2 WHERE id = $3',
      [externalId, ADDRESS, reference],
    );
    await client.query('ALTER TABLE crm.interaction ENABLE TRIGGER refuse_erased_value');
    await client.query('ALTER TABLE crm.external_reference ENABLE TRIGGER refuse_erased_value');
  });
}

describe('crm.erase_subject', { timeout: 60_000 }, () => {
  it('runs only for app_worker, only for an erased party of the tenant', async () => {
    expect((await callAs('app_api', tenant, ERASE_CRM, [parts.person])).code).toBe('42501');
    expect((await clearCrm()).code).toBe('55000');
    expect((await clearCrm(null)).code).toBe('55000');
  });

  it('clears the personal values, keeps everything else, and counts', async () => {
    const request = await asMigratorIn(tenant.id, (client) =>
      addErasureRequest(client, tenant, parts.member, parts.person),
    );
    expect((await erase(tenant, parts.person, request)).code).toBeUndefined();
    expect((await clearCrm(await createTestTenant())).code).toBe('55000');

    const { row, code } = await clearCrm();
    expect(code).toBeUndefined();
    expect(row?.['counts']).toEqual({
      'crm.interaction': 1,
      'crm.import_row': 2,
      'crm.external_reference': 1,
    });
    expect(await state()).toEqual(cleared());
    expect((await clearCrm()).row?.['counts']).toEqual({
      'crm.interaction': 0,
      'crm.import_row': 0,
      'crm.external_reference': 0,
    });
  });

  it('refuses any new value about the erased party, whoever writes it', async () => {
    expect(
      await insertOutcome(
        'app_api',
        tenant,
        'crm.interaction',
        noteRow(tenant, parts.person, parts.member),
      ),
    ).toBe('55000');
    expect(
      await insertOutcome(
        'app_api',
        tenant,
        'crm.external_reference',
        referenceRow(tenant, parts.person, parts.member),
      ),
    ).toBe('55000');
    const code = await asMigratorIn(tenant.id, (client) =>
      outcome(client, 'UPDATE crm.interaction SET summary = $1 WHERE id = $2', [SUMMARY, note]),
    );
    expect(code).toBe('55000');
  });

  it('clears the pre-erasure rows again after a restore', async () => {
    await restorePreErasure();
    expect((await clearCrm()).row?.['counts']).toEqual({
      'crm.interaction': 1,
      'crm.import_row': 2,
      'crm.external_reference': 1,
    });
    expect(await state()).toEqual(cleared());
  });

  it('leaves a live party alone', async () => {
    expect((await callAs('app_worker', tenant, ERASE_CRM, [live])).code).toBe('55000');
  });
});
