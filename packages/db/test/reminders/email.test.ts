// SPDX-License-Identifier: AGPL-3.0-or-later
//
// grants.reminder_email (migration 0061): denied across tenants, every key
// kept in the tenant, exactly one subject, one row per subject, kind and
// occurrence, what each role may read and write, attempts and times set by
// the database, and rule 9: writing reminders changes nothing else.

import { beforeAll, describe, expect, it } from 'vitest';

import { withClient } from '../connect.ts';
import { expectCrossTenantDenial } from '../cross-tenant.ts';
import { callAs } from '../erasure/fixtures.ts';
import { insertOutcome } from '../notes/fixtures.ts';
import {
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  insertStatement,
  outcome,
  type Row,
  type TestTenant,
} from '../tenants.ts';
import {
  addReminded,
  draftReminder,
  FAILED,
  type Reminded,
  reviewReminder,
  settingRow,
} from './fixtures.ts';

const TABLE = 'grants.reminder_email';

let tenant: TestTenant;
let to: Reminded;
let strangers: Reminded;

beforeAll(async () => {
  tenant = await createTestTenant();
  const stranger = await createTestTenant();
  to = await asMigratorIn(tenant.id, (client) => addReminded(client, tenant));
  strangers = await asMigratorIn(stranger.id, (client) => addReminded(client, stranger));
}, 60_000);

const asWorker = (row: Row) => insertOutcome('app_worker', tenant, TABLE, row);
const draft = (change: Row = {}) => draftReminder(tenant, to, change);
const review = (change: Row = {}) => reviewReminder(tenant, to, change);

/** A new reminder about a new application, committed as migrator. */
const addReminder = (change: Row = {}) =>
  asMigratorIn(tenant.id, async (client) =>
    insertRow(client, TABLE, draftReminder(tenant, await addReminded(client, tenant), change)),
  );

describe(TABLE, { timeout: 30_000 }, () => {
  it('is denied across tenants', () =>
    // A failed reminder, which app_worker may try again.
    expectCrossTenantDenial(TABLE, async (client, owner) =>
      draftReminder(owner, await addReminded(client, owner), FAILED),
    ));

  it("refuses another tenant's application, assignment, person or template", async () => {
    expect(await asWorker(draft())).toBe('ok');
    expect(await asWorker(review())).toBe('ok');
    for (const row of [
      draft({ application_id: strangers.application }),
      review({ assignment_id: strangers.assignment }),
      draft({ recipient_person_id: strangers.person }),
      draft({ template_version_id: strangers.template }),
    ]) {
      expect(await asWorker(row)).toBe('23503');
    }
  });

  it.each([
    ['a draft reminder naming an assignment', () => draft({ assignment_id: to.assignment })],
    ['a review reminder naming an application', () => review({ application_id: to.application })],
    ['a reminder with no subject', () => draft({ application_id: null })],
    ['an unknown kind', () => draft({ kind: 'decision_due' })],
    ['a draft occurrence out of range', () => draft({ occurrence: 31 })],
    ['a review occurrence out of range', () => review({ occurrence: 4 })],
  ])('refuses %s', async (_, row) => {
    expect(await asWorker(row())).toBe('23514');
  });

  it('holds one row per subject, kind and occurrence', () =>
    asRoleIn('app_worker', tenant.id, async (client) => {
      const attempt = (row: Row) => {
        const { text, values } = insertStatement(client, TABLE, row);
        return outcome(client, text, values);
      };
      for (const row of [draft(), review()]) {
        await insertRow(client, TABLE, row);
        expect(await attempt(row)).toBe('23505');
      }
      expect(await attempt(draft({ occurrence: 1 }))).toBe('ok');
      expect(await attempt(review({ occurrence: 2 }))).toBe('ok');
    }));

  it('starts pending, and takes no status, code, count or time from the worker', async () => {
    await asRoleIn('app_worker', tenant.id, async (client) => {
      const id = await insertRow(client, TABLE, draft());
      const { rows } = await client.query<Row>(
        `SELECT status, outcome_code, attempts, last_attempt_at, sent_at FROM ${TABLE} WHERE id = $1`,
        [id],
      );
      expect(rows[0]).toEqual({
        status: 'pending',
        outcome_code: null,
        attempts: 0,
        last_attempt_at: null,
        sent_at: null,
      });
    });
    for (const change of [
      { status: 'sent' },
      { outcome_code: 'closed' },
      { attempts: 1 },
      { sent_at: new Date() },
      { created_at: new Date(0) },
    ]) {
      expect(await asWorker(draft(change)), Object.keys(change)[0]).toBe('42501');
    }
    expect(await insertOutcome('app_api', tenant, TABLE, draft())).toBe('42501');
  });

  it('records each attempt, ties codes and times to the status, and keeps sent and skipped', async () => {
    const id = await addReminder();
    await asRoleIn('app_worker', tenant.id, async (client) => {
      const set = (status: string, code: string | null) =>
        outcome(client, `UPDATE ${TABLE} SET status = $2, outcome_code = $3 WHERE id = $1`, [
          id,
          status,
          code,
        ]);
      expect(await set('failed', null)).toBe('23514');
      expect(await set('failed', 'not_a_code')).toBe('23514');
      expect(await set('sent', 'closed')).toBe('23514');
      expect(await set('pending', null)).toBe('55000');
      await client.query(
        `UPDATE ${TABLE} SET status = 'failed', outcome_code = 'delivery_failed' WHERE id = $1`,
        [id],
      );
      await client.query(`UPDATE ${TABLE} SET status = 'sent', outcome_code = NULL WHERE id = $1`, [
        id,
      ]);
      const { rows } = await client.query<Row>(
        `SELECT attempts, last_attempt_at IS NOT NULL AS tried, sent_at IS NOT NULL AS sent
           FROM ${TABLE} WHERE id = $1`,
        [id],
      );
      expect(rows[0]).toEqual({ attempts: 2, tried: true, sent: true });
      expect(await set('failed', 'delivery_failed')).toBe('55000');
      for (const column of [
        'attempts',
        'sent_at',
        'last_attempt_at',
        'recipient_person_id',
        'kind',
      ]) {
        expect(
          await outcome(client, `UPDATE ${TABLE} SET ${column} = ${column} WHERE id = $1`, [id]),
          column,
        ).toBe('42501');
      }
    });
    const skipped = await addReminder();
    await asRoleIn('app_worker', tenant.id, async (client) => {
      await client.query(
        `UPDATE ${TABLE} SET status = 'skipped', outcome_code = 'not_needed' WHERE id = $1`,
        [skipped],
      );
      expect(
        await outcome(client, `UPDATE ${TABLE} SET outcome_code = 'superseded' WHERE id = $1`, [
          skipped,
        ]),
      ).toBe('55000');
    });
  });

  it('never changes its subject, recipient, kind or occurrence, even for migrator', async () => {
    const id = await addReminder();
    const other = await asMigratorIn(tenant.id, (client) => addReminded(client, tenant));
    for (const [column, value] of [
      ['application_id', other.application],
      ['recipient_person_id', other.person],
      ['template_version_id', other.template],
      ['occurrence', 1],
    ] as const) {
      const code = await asMigratorIn(tenant.id, (client) =>
        outcome(client, `UPDATE ${TABLE} SET ${column} = $2 WHERE id = $1`, [id, value]),
      );
      expect(code, column).toBe('23514');
    }
  });

  it("is read by app_api for the round's history, and never written by it", async () => {
    const id = await addReminder();
    await asRoleIn('app_api', tenant.id, async (client) => {
      const { rows } = await client.query<Row>(
        `SELECT id, kind, status, attempts FROM ${TABLE} WHERE id = $1`,
        [id],
      );
      expect(rows).toEqual([{ id, kind: 'draft_closing', status: 'pending', attempts: 0 }]);
      for (const column of ['status', 'outcome_code', 'recipient_person_id']) {
        expect(
          await outcome(client, `UPDATE ${TABLE} SET ${column} = ${column} WHERE id = $1`, [id]),
          column,
        ).toBe('42501');
      }
    });
  });

  it('is deleted by no app role', async () => {
    const id = await addReminder();
    for (const role of ['app_api', 'app_worker'] as const) {
      await asRoleIn(role, tenant.id, async (client) => {
        expect(await outcome(client, `DELETE FROM ${TABLE} WHERE id = $1`, [id]), role).toBe(
          '42501',
        );
      });
    }
  });

  it('only reminds: writing reminders as each role changes no application, assignment or decision', async () => {
    const snapshot = () =>
      asMigratorIn(tenant.id, async (client) => {
        const read = async (table: string) =>
          (await client.query<Row>(`SELECT * FROM ${table} ORDER BY id`)).rows;
        return [
          await read('grants.application'),
          await read('grants.assignment'),
          await read('grants.decision'),
        ];
      });
    const committed = async (role: 'app_api' | 'app_worker', text: string, values: unknown[]) => {
      const { row, code } = await callAs(role, tenant, text, values);
      expect(code, text).toBeUndefined();
      return row;
    };
    const insert = (table: string, row: Row) => {
      const columns = Object.keys(row);
      const slots = columns.map((_, index) => `$${String(index + 1)}`);
      return `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${slots.join(', ')}) RETURNING id`;
    };
    const before = await snapshot();
    const setting = settingRow(tenant, to);
    await committed('app_api', insert('grants.reminder_setting', setting), Object.values(setting));
    await committed(
      'app_api',
      'UPDATE grants.reminder_setting SET review_enabled = false WHERE round_id = $1',
      [to.round],
    );
    const reminder = review({ occurrence: 3 });
    const row = await committed('app_worker', insert(TABLE, reminder), Object.values(reminder));
    await committed(
      'app_worker',
      `UPDATE ${TABLE} SET status = 'skipped', outcome_code = 'switched_off' WHERE id = $1`,
      [row?.['id']],
    );
    expect(await snapshot()).toEqual(before);
  });

  it('has triggers that write no other table, and keys that restrict', () =>
    withClient('migrator', async (client) => {
      const { rows } = await client.query<{ trigger: string; source: string }>(
        `SELECT t.tgrelid::regclass || ' ' || t.tgname || ' ' || p.oid::regprocedure AS trigger,
                p.prosrc AS source
           FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
          WHERE t.tgrelid IN ('grants.reminder_setting'::regclass, 'grants.reminder_email'::regclass)
            AND NOT t.tgisinternal ORDER BY 1`,
      );
      expect(rows.map(({ trigger }) => trigger).sort()).toEqual([
        'grants.reminder_email keep_reminder_email grants.keep_reminder_email()',
        'grants.reminder_email record_reminder_attempt grants.record_reminder_attempt()',
        'grants.reminder_email refuse_erased_party party.refuse_erased_party()',
        'grants.reminder_email set_created_at app.set_created_at()',
        'grants.reminder_setting version_reminder_setting grants.version_reminder_setting()',
      ]);
      // The erased-party guard reads party.is_erased only; the rest name no table.
      for (const { trigger, source } of rows.filter(({ trigger }) => !trigger.includes('party.'))) {
        expect(source, trigger).not.toMatch(/\b(?:app|grants|party|auth|pgboss)\.[a-z_]+/);
      }
      const keys = await client.query<{ actions: string }>(
        `SELECT pg_catalog.string_agg(DISTINCT c.confdeltype::text || c.confupdtype::text, ',') AS actions
           FROM pg_catalog.pg_constraint c
          WHERE c.contype = 'f'
            AND c.conrelid IN ('grants.reminder_setting'::regclass, 'grants.reminder_email'::regclass)`,
      );
      expect(keys.rows[0]?.actions).toBe('ra');
    }));

  it('has its queues and dead-letter queues, of tenant kind', () =>
    withClient('migrator', async (client) => {
      const { rows } = await client.query<Row>(
        `SELECT r.name, r.kind, q.dead_letter, q.policy
           FROM app.job_queue r JOIN pgboss.queue q ON q.name = r.name
          WHERE r.name LIKE 'grants.reminder%' ORDER BY r.name`,
      );
      expect(rows).toEqual([
        {
          name: 'grants.reminder_scan',
          kind: 'tenant',
          dead_letter: 'grants.reminder_scan.dead',
          policy: 'standard',
        },
        {
          name: 'grants.reminder_scan.dead',
          kind: 'tenant',
          dead_letter: null,
          policy: 'standard',
        },
        {
          name: 'grants.reminder_send',
          kind: 'tenant',
          dead_letter: 'grants.reminder_send.dead',
          policy: 'exclusive',
        },
        {
          name: 'grants.reminder_send.dead',
          kind: 'tenant',
          dead_letter: null,
          policy: 'standard',
        },
      ]);
    }));
});
