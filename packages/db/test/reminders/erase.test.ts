// SPDX-License-Identifier: AGPL-3.0-or-later
//
// grants.erase_reminders (migration 0062, ADR 0027): only app_worker runs
// it, only for a party already erased in the transaction's tenant; it clears
// the recipient, keeps ids, status and times, deletes nothing and, called
// again after a restore, clears the restored rows. No new reminder names the
// erased party, and no write puts them back.

import { beforeAll, describe, expect, it } from 'vitest';

import { addErasureRequest, callAs, erase } from '../erasure/fixtures.ts';
import { insertOutcome } from '../notes/fixtures.ts';
import {
  addMember,
  asMigratorIn,
  createTestTenant,
  insertRow,
  outcome,
  type Row,
  type TestTenant,
} from '../tenants.ts';
import { addReminded, draftReminder, FAILED, type Reminded, reviewReminder } from './fixtures.ts';

const ERASE_REMINDERS = 'SELECT grants.erase_reminders($1) AS counts';
const TABLE = 'grants.reminder_email';

let tenant: TestTenant;
let to: Reminded;
let kept: Reminded;
let pending: string;
let failed: string;
let other: string;

const clear = (party: string, inTenant: TestTenant | null = tenant) =>
  callAs('app_worker', inTenant ?? undefined, ERASE_REMINDERS, [party]);

const rowsOf = (ids: readonly string[]) =>
  asMigratorIn(tenant.id, async (client) => {
    const { rows } = await client.query<Row>(
      `SELECT id, recipient_person_id, status, outcome_code, attempts FROM ${TABLE}
        WHERE id = ANY ($1::uuid[]) ORDER BY id`,
      [ids],
    );
    return rows;
  });

beforeAll(async () => {
  tenant = await createTestTenant();
  await asMigratorIn(tenant.id, async (client) => {
    to = await addReminded(client, tenant);
    kept = await addReminded(client, tenant);
    pending = await insertRow(client, TABLE, draftReminder(tenant, to));
    failed = await insertRow(client, TABLE, reviewReminder(tenant, to, FAILED));
    other = await insertRow(client, TABLE, draftReminder(tenant, kept));
  });
}, 60_000);

describe('grants.erase_reminders', { timeout: 60_000 }, () => {
  it('runs only for app_worker, only for an erased party of the tenant', async () => {
    expect((await callAs('app_api', tenant, ERASE_REMINDERS, [to.person])).code).toBe('42501');
    expect((await clear(to.person)).code).toBe('55000');
    expect((await clear(to.person, null)).code).toBe('55000');
  });

  it('clears the recipient, keeps everything else, and counts', async () => {
    const before = await rowsOf([pending, failed, other]);
    const request = await asMigratorIn(tenant.id, async (client) =>
      addErasureRequest(
        client,
        tenant,
        await addMember(client, tenant, ['programme_manager']),
        to.person,
      ),
    );
    expect((await erase(tenant, to.person, request)).code).toBeUndefined();
    expect((await clear(to.person, await createTestTenant())).code).toBe('55000');

    const { row, code } = await clear(to.person);
    expect(code).toBeUndefined();
    expect(row?.['counts']).toEqual({ 'grants.reminder_email': 2 });
    expect(await rowsOf([pending, failed, other])).toEqual(
      before.map((reminder) =>
        reminder['id'] === other ? reminder : { ...reminder, recipient_person_id: null },
      ),
    );
    expect((await clear(to.person)).row?.['counts']).toEqual({ 'grants.reminder_email': 0 });
  });

  it('refuses a new reminder for, or a write naming, the erased party', async () => {
    const fresh = draftReminder(tenant, to, { occurrence: 1 });
    expect(await insertOutcome('app_worker', tenant, TABLE, fresh)).toBe('55000');
    const named = await asMigratorIn(tenant.id, (client) =>
      outcome(client, `UPDATE ${TABLE} SET recipient_person_id = $1 WHERE id = $2`, [
        to.person,
        pending,
      ]),
    );
    expect(named).toBe('23514');
  });

  it('clears the pre-erasure rows again after a restore', async () => {
    await asMigratorIn(tenant.id, async (client) => {
      for (const state of ['DISABLE', 'ENABLE']) {
        await client.query(`ALTER TABLE ${TABLE} ${state} TRIGGER keep_reminder_email`);
        await client.query(`ALTER TABLE ${TABLE} ${state} TRIGGER refuse_erased_party`);
        if (state === 'DISABLE') {
          await client.query(
            `UPDATE ${TABLE} SET recipient_person_id = $1 WHERE id = ANY ($2::uuid[])`,
            [to.person, [pending, failed]],
          );
        }
      }
    });
    expect((await clear(to.person)).row?.['counts']).toEqual({ 'grants.reminder_email': 2 });
    const rows = await rowsOf([pending, failed]);
    expect(rows.map((reminder) => reminder['recipient_person_id'])).toEqual([null, null]);
  });

  it('leaves a live party alone', async () => {
    expect((await clear(kept.person)).code).toBe('55000');
  });
});
