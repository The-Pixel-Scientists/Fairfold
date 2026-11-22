// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Rights requests, clock events, tasks, breaches, assessments, processing
// activities and DPIAs (migrations 0089 to 0091): the clock takes events only in an
// order it can follow, events and assessments never change, the 72-hour
// and notice checks hold, the database sets each time no member chooses,
// a signed-off DPIA and its links stay as they are until reopened, and no
// trigger or function decides for a person or writes an audit event (rules
// 4 and 9). No app role may delete a row but a link.

import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import { withClient } from '../connect.ts';
import {
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  insertStatement,
  type Row,
  type TestTenant,
} from '../tenants.ts';
import {
  activityRow,
  addPrivacyParts,
  assessmentRow,
  breachRow,
  eventRow,
  insertOutcome,
  requestRow,
  type PrivacyParts,
} from './fixtures.ts';

let tenant: TestTenant;
let parts: PrivacyParts;
beforeAll(async () => {
  tenant = await createTestTenant();
  parts = await asMigratorIn(tenant.id, (client) => addPrivacyParts(client, tenant));
}, 60_000);

/** Run `work` as app_api in the tenant, and roll it back. */
const asApi = <T>(work: (client: pg.Client) => Promise<T>) => asRoleIn('app_api', tenant.id, work);

/** Run one statement in a savepoint, kept if it succeeds: ok, or its SQLSTATE. */
async function step(
  client: pg.ClientBase,
  text: string,
  values: readonly unknown[] = [],
): Promise<string> {
  await client.query('SAVEPOINT step');
  try {
    await client.query(text, [...values]);
    await client.query('RELEASE SAVEPOINT step');
    return 'ok';
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT step');
    const { code } = error as pg.DatabaseError;
    if (!code) throw error;
    return code;
  }
}

const insert = (client: pg.ClientBase, table: string, row: Row) => {
  const { text, values } = insertStatement(client, table, row);
  return step(client, text, values);
};

/** One row of `text`'s result, which must have one. */
async function one(client: pg.ClientBase, text: string, values: unknown[]): Promise<Row> {
  const { rows } = await client.query<Row>(text, values);
  const [row] = rows;
  if (!row) throw new Error(`No row from: ${text}`);
  return row;
}

describe('a rights request', { timeout: 30_000 }, () => {
  it('has a due date exactly while its clock is not paused', async () => {
    const row = (change: Row) => requestRow(tenant, parts.person, parts.member, change);
    expect(
      await insertOutcome('app_api', tenant, 'privacy.rights_request', row({ due_on: null })),
    ).toBe('23514');
    await asApi(async (client) => {
      const set = (state: string, due: string | null) =>
        step(
          client,
          'UPDATE privacy.rights_request SET clock_state = $1, due_on = $2 WHERE id = $3',
          [state, due, parts.request],
        );
      expect(await set('paused', null)).toBe('ok');
      expect(await set('paused', '2026-12-02')).toBe('23514');
      expect(await set('overdue', '2026-12-02')).toBe('23514');
    });
  });

  it('keeps its subject and received time, and is never deleted', async () => {
    await asApi(async (client) => {
      for (const column of ['subject_person_id', 'received_at', 'received_on']) {
        expect(
          await step(
            client,
            `UPDATE privacy.rights_request SET ${column} = ${column} WHERE id = $1`,
            [parts.request],
          ),
          column,
        ).toBe('42501');
      }
      expect(await step(client, 'DELETE FROM privacy.rights_request')).toBe('42501');
    });
  });
});

describe('clock events', { timeout: 30_000 }, () => {
  let request: string;
  beforeAll(async () => {
    request = await asMigratorIn(tenant.id, (client) =>
      insertRow(client, 'privacy.rights_request', requestRow(tenant, parts.person, parts.member)),
    );
  });

  const event = (client: pg.ClientBase, change: Row) =>
    insert(client, 'privacy.request_clock_event', eventRow(tenant, request, parts.member, change));

  it('are taken only in an order the clock can follow', async () => {
    await asApi(async (client) => {
      expect(await event(client, { occurred_on: '2026-11-01' }), 'before received').toBe('55000');
      expect(await event(client, {})).toBe('ok');
      expect(await event(client, {}), 'second pause').toBe('55000');
      expect(
        await event(client, {
          kind: 'resumed',
          occurred_on: '2026-11-02',
          reason_code: 'information_received',
        }),
        'resume before the pause',
      ).toBe('55000');
      const resume = {
        kind: 'resumed',
        occurred_on: '2026-11-05',
        reason_code: 'information_received',
      };
      expect(await event(client, resume)).toBe('ok');
      expect(await event(client, resume), 'resume without a pause').toBe('55000');
      const extend = {
        kind: 'extended',
        occurred_on: '2026-11-06',
        months: 2,
        reason_code: 'complex',
      };
      expect(await event(client, extend)).toBe('ok');
      expect(await event(client, extend), 'second extension').toBe('23505');
      const close = { kind: 'closed', occurred_on: '2026-11-20', reason_code: 'completed' };
      expect(await event(client, close)).toBe('ok');
      expect(await event(client, { occurred_on: '2026-11-21' }), 'after the close').toBe('55000');
    });
  });

  it('carry a reason of their kind, and months only on an extension', async () => {
    await asApi(async (client) => {
      expect(await event(client, { reason_code: 'complex' })).toBe('23514');
      expect(await event(client, { months: 1 })).toBe('23514');
      expect(await event(client, { kind: 'extended', reason_code: 'complex' })).toBe('23514');
      expect(await event(client, { kind: 'extended', months: 3, reason_code: 'complex' })).toBe(
        '23514',
      );
      expect(await event(client, { kind: 'closed', reason_code: 'complex' })).toBe('23514');
    });
  });

  it('are never changed or removed, and take their time from the database', async () => {
    await asApi(async (client) => {
      const { id, created_at: createdAt } = await one(
        client,
        `INSERT INTO privacy.request_clock_event (tenant_id, request_id, kind, occurred_on, reason_code, recorded_by)
         VALUES ($1, $2, 'paused', '2026-11-03', 'clarification', $3) RETURNING id, created_at`,
        [tenant.id, request, parts.member],
      );
      const { now } = await one(client, 'SELECT pg_catalog.now() AS now', []);
      expect(createdAt).toEqual(now);
      expect(await step(client, 'UPDATE privacy.request_clock_event SET kind = kind')).toBe(
        '42501',
      );
      expect(
        await step(client, 'DELETE FROM privacy.request_clock_event WHERE id = $1', [id]),
      ).toBe('42501');
    });
  });
});

describe('a request task', { timeout: 30_000 }, () => {
  it('is completed once, at a time the database sets', async () => {
    await asApi(async (client) => {
      const { id } = await one(
        client,
        `INSERT INTO privacy.request_task (tenant_id, request_id, title, created_by, updated_by)
         VALUES ($1, $2, 'Synthetic task', $3, $3) RETURNING id`,
        [tenant.id, parts.request, parts.member],
      );
      const complete = (member: string | null) =>
        step(client, 'UPDATE privacy.request_task SET completed_by = $1 WHERE id = $2', [
          member,
          id,
        ]);
      expect(await complete(parts.member)).toBe('ok');
      const { completed_at: completedAt, now } = await one(
        client,
        'SELECT completed_at, pg_catalog.now() AS now FROM privacy.request_task WHERE id = $1',
        [id],
      );
      expect(completedAt).toEqual(now);
      expect(await complete(null)).toBe('55000');
      expect(await step(client, 'UPDATE privacy.request_task SET completed_at = NULL')).toBe(
        '42501',
      );
      expect(await step(client, 'DELETE FROM privacy.request_task')).toBe('42501');
    });
  });
});

describe('a breach', { timeout: 30_000 }, () => {
  it('lists at least one known data category', async () => {
    for (const categories of [[], ['passwords'], [null], ['contact', null]]) {
      const row = breachRow(tenant, parts.member, { data_categories: categories });
      expect(
        await insertOutcome('app_api', tenant, 'privacy.breach', row),
        String(categories),
      ).toBe('23514');
    }
  });

  const notify = (
    client: pg.ClientBase,
    at: string,
    reason: string | null,
    reference: string | null = 'ICO-1',
  ) =>
    step(
      client,
      `UPDATE privacy.breach SET ico_notified_at = $1, ico_reference = $2, ico_late_reason = $3,
              ico_recorded_by = $4 WHERE id = $5`,
      [at, reference, reason, parts.member, parts.breach],
    );

  it('needs a late reason exactly when the ICO is told after 72 hours', async () => {
    await asApi(async (client) => {
      expect(await notify(client, '2026-11-05T09:00:00Z', 'other'), 'on time, with a reason').toBe(
        '23514',
      );
      expect(await notify(client, '2026-11-05T09:00:01Z', null), 'late, no reason').toBe('23514');
      expect(await notify(client, '2026-11-02T08:59:59Z', null), 'before aware').toBe('23514');
      expect(await notify(client, '2026-11-05T09:00:00Z', null, null), 'no reference').toBe(
        '23514',
      );
      expect(await notify(client, '2026-11-05T09:00:00Z', null), 'on time').toBe('ok');
    });
    await asApi(async (client) => {
      expect(await notify(client, '2026-11-06T09:00:00Z', 'still_investigating'), 'late').toBe(
        'ok',
      );
    });
  });

  it('records each notification once, at a time the database sets', async () => {
    await asApi(async (client) => {
      expect(await notify(client, '2026-11-03T09:00:00Z', null)).toBe('ok');
      const subjects = await step(
        client,
        `UPDATE privacy.breach SET subjects_notified_at = '2026-11-03T10:00:00Z',
                subjects_notice_method = 'email', subjects_recorded_by = $1 WHERE id = $2`,
        [parts.member, parts.breach],
      );
      expect(subjects).toBe('ok');
      const row = await one(
        client,
        `SELECT ico_recorded_at, subjects_recorded_at, pg_catalog.now() AS now
           FROM privacy.breach WHERE id = $1`,
        [parts.breach],
      );
      expect([row['ico_recorded_at'], row['subjects_recorded_at']]).toEqual([
        row['now'],
        row['now'],
      ]);
      expect(await notify(client, '2026-11-03T09:00:00Z', null, 'ICO-2')).toBe('55000');
      expect(await step(client, "UPDATE privacy.breach SET subjects_notice_method = 'post'")).toBe(
        '55000',
      );
      expect(await step(client, 'UPDATE privacy.breach SET became_aware_at = now()')).toBe('42501');
      expect(await step(client, 'DELETE FROM privacy.breach')).toBe('42501');
    });
  });

  it('keeps every assessment as made', async () => {
    await asApi(async (client) => {
      expect(
        await insert(
          client,
          'privacy.breach_assessment',
          assessmentRow(tenant, parts.breach, parts.member),
        ),
      ).toBe('ok');
      expect(
        await step(client, "UPDATE privacy.breach_assessment SET risk_level = 'unlikely'"),
      ).toBe('42501');
      expect(await step(client, 'DELETE FROM privacy.breach_assessment')).toBe('42501');
    });
  });
});

describe('processing activities', { timeout: 30_000 }, () => {
  it('are archived once, at a time the database sets, and named once among the rest', async () => {
    await asApi(async (client) => {
      const name = 'Synthetic duplicate activity';
      const add = () =>
        insert(client, 'privacy.processing_activity', activityRow(tenant, parts.member, { name }));
      expect(await add()).toBe('ok');
      expect(await add()).toBe('23505');
      const archived = await one(
        client,
        `UPDATE privacy.processing_activity SET archived_at = '2000-01-01' WHERE name = $1
         RETURNING id, archived_at, pg_catalog.now() AS now`,
        [name],
      );
      expect(archived['archived_at']).toEqual(archived['now']);
      expect(await add()).toBe('ok');
      expect(
        await step(
          client,
          'UPDATE privacy.processing_activity SET archived_at = NULL WHERE id = $1',
          [archived['id']],
        ),
      ).toBe('23514');
      expect(await step(client, 'DELETE FROM privacy.processing_activity')).toBe('42501');
      expect(await step(client, 'DELETE FROM privacy.processor')).toBe('42501');
    });
  });
});

describe('a DPIA', { timeout: 30_000 }, () => {
  const link = (client: pg.ClientBase, activity: string) =>
    insert(client, 'privacy.dpia_processing_activity', {
      tenant_id: tenant.id,
      dpia_id: parts.dpia,
      processing_activity_id: activity,
      created_by: parts.member,
    });
  const update = (client: pg.ClientBase, set: string, values: unknown[] = []) =>
    step(client, `UPDATE privacy.dpia SET ${set} WHERE id = $1`, [parts.dpia, ...values]);

  it('is signed off by a member at a time the database sets, and then stays as signed', async () => {
    await asApi(async (client) => {
      expect(await link(client, parts.activity)).toBe('ok');
      expect(await update(client, "status = 'signed_off'"), 'no signer').toBe('23514');
      expect(await update(client, "status = 'review_due'"), 'not signed off').toBe('55000');
      const signOff = "status = 'signed_off', signed_off_by = $2, review_on = '2027-11-01'";
      expect(await update(client, signOff, [parts.member])).toBe('ok');
      const signed = await one(
        client,
        'SELECT signed_off_at, pg_catalog.now() AS now FROM privacy.dpia WHERE id = $1',
        [parts.dpia],
      );
      expect(signed['signed_off_at']).toEqual(signed['now']);

      const other = await insertRow(
        client,
        'privacy.processing_activity',
        activityRow(tenant, parts.member),
      );
      expect(await link(client, other), 'a new link').toBe('55000');
      expect(
        await step(client, 'DELETE FROM privacy.dpia_processing_activity'),
        'a removed link',
      ).toBe('55000');
      expect(await update(client, "title = 'Synthetic change'")).toBe('55000');
      expect(await update(client, "review_on = '2028-01-01'")).toBe('55000');
      expect(await update(client, "status = 'review_due'")).toBe('ok');
      expect(await update(client, "status = 'signed_off'"), 'signed again unopened').toBe('55000');

      const reopen = "status = 'in_review', signed_off_by = NULL, review_on = NULL";
      expect(await update(client, reopen)).toBe('ok');
      const reopened = await one(client, 'SELECT signed_off_at FROM privacy.dpia WHERE id = $1', [
        parts.dpia,
      ]);
      expect(reopened['signed_off_at']).toBeNull();
      expect(await link(client, other)).toBe('ok');
      expect(await step(client, 'DELETE FROM privacy.dpia_processing_activity')).toBe('ok');
      expect(await update(client, 'signed_off_at = now()')).toBe('42501');
      expect(await step(client, 'DELETE FROM privacy.dpia')).toBe('42501');
    });
  });

  it('takes screening as an object and risks as a list, each capped', async () => {
    await asApi(async (client) => {
      expect(await update(client, "screening = '[]'")).toBe('23514');
      expect(await update(client, "risks = '{}'")).toBe('23514');
      expect(
        await update(client, 'screening = $2', [JSON.stringify({ q_big: 'x'.repeat(65_536) })]),
      ).toBe('23514');
      expect(await update(client, 'screening = $2', [JSON.stringify({ q_1: 'yes' })])).toBe('ok');
    });
  });
});

describe('the privacy functions', () => {
  it('write no audit event, config version, job or other table, and decide nothing', async () => {
    const { rows } = await withClient('migrator', (client) =>
      client.query<{ name: string; source: string }>(
        `SELECT p.proname AS name, p.prosrc AS source FROM pg_catalog.pg_proc p
          WHERE p.pronamespace = 'privacy'::regnamespace ORDER BY 1`,
      ),
    );
    expect(rows.map(({ name }) => name)).toEqual([
      'check_clock_event',
      'check_dpia',
      'erase_subject',
      'refuse_erased_text',
      'refuse_signed_off_link',
      'set_archived_at',
      'stamp_breach_notices',
      'stamp_completion',
    ]);
    for (const { name, source } of rows) {
      expect(source, name).not.toMatch(
        /audit_event|config_version|pgboss|INSERT\s+INTO|DELETE\s+FROM/i,
      );
      const updated = [
        ...source.matchAll(/UPDATE\s+([a-z_]+\.[a-z_]+)\s+[a-z]+\s+SET\s+([a-z_]+)/gi),
      ];
      expect(
        updated.map(([, table, column]) => `${table ?? ''}.${column ?? ''}`),
        name,
      ).toEqual(
        name === 'erase_subject'
          ? ['privacy.rights_request.summary', 'privacy.request_task.title']
          : [],
      );
    }
  });
});
