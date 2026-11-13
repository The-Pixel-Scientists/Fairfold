// SPDX-License-Identifier: AGPL-3.0-or-later
//
// grants.reminder_setting (migration 0060): denied across tenants, every key
// kept in the tenant, one per round, the checks on days and switches, and a
// version and times that only the database sets.

import { beforeAll, describe, expect, it } from 'vitest';

import { expectCrossTenantDenial } from '../cross-tenant.ts';
import { insertOutcome } from '../notes/fixtures.ts';
import {
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  insertStatement,
  outcome,
  type TestTenant,
} from '../tenants.ts';
import { addReminded, type Reminded, settingRow } from './fixtures.ts';

const TABLE = 'grants.reminder_setting';

let tenant: TestTenant;
let to: Reminded;
let strangers: Reminded;

beforeAll(async () => {
  tenant = await createTestTenant();
  const stranger = await createTestTenant();
  to = await asMigratorIn(tenant.id, (client) => addReminded(client, tenant));
  strangers = await asMigratorIn(stranger.id, (client) => addReminded(client, stranger));
}, 60_000);

const insertAsApi = (change = {}) =>
  insertOutcome('app_api', tenant, TABLE, settingRow(tenant, to, change));

describe(TABLE, { timeout: 30_000 }, () => {
  it('is denied across tenants', () =>
    expectCrossTenantDenial(TABLE, async (client, owner) =>
      settingRow(owner, await addReminded(client, owner)),
    ));

  it("refuses another tenant's round, template or member", async () => {
    expect(await insertAsApi()).toBe('ok');
    for (const change of [
      { round_id: strangers.round },
      { draft_template_version_id: strangers.draftTemplate },
      { review_template_version_id: strangers.reviewTemplate },
      { created_by: strangers.member },
      { updated_by: strangers.member },
    ]) {
      expect(await insertAsApi(change), Object.keys(change)[0]).toBe('23503');
    }
  });

  it.each([
    ['a day out of range', { draft_days_before_1: 31 }],
    ['no days', { draft_days_before_1: 0 }],
    ['days not largest first', { draft_days_before_2: 14 }],
    ['a gap in the days', { draft_days_before_2: null }],
    [
      'drafts on with no days',
      { draft_days_before_1: null, draft_days_before_2: null, draft_days_before_3: null },
    ],
    ['drafts on with no email', { draft_template_version_id: null }],
    ['reviews on with no email', { review_template_version_id: null }],
    ['an overdue delay out of range', { review_overdue_after_days: 61 }],
    ['a repeat out of range', { review_repeat_every_days: 0 }],
  ])('refuses %s', async (_, change) => {
    expect(await insertAsApi(change)).toBe('23514');
  });

  it('keeps an off kind without its values', async () => {
    expect(
      await insertAsApi({
        draft_enabled: false,
        draft_days_before_1: null,
        draft_days_before_2: null,
        draft_days_before_3: null,
        draft_template_version_id: null,
        review_enabled: false,
        review_template_version_id: null,
      }),
    ).toBe('ok');
  });

  it('holds one setting per round', () =>
    asRoleIn('app_api', tenant.id, async (client) => {
      await insertRow(client, TABLE, settingRow(tenant, to));
      const { text, values } = insertStatement(client, TABLE, settingRow(tenant, to));
      expect(await outcome(client, text, values)).toBe('23505');
    }));

  it('counts versions and sets its times, and takes neither from app_api', async () => {
    const id = await asMigratorIn(tenant.id, async (client) => {
      const row = await client.query<{ id: string; version: number; created_at: Date }>(
        `INSERT INTO ${TABLE} (tenant_id, round_id, draft_enabled, review_enabled,
           review_overdue_after_days, review_repeat_every_days, created_by, updated_by,
           version, created_at, updated_at)
         VALUES ($1, $2, false, false, 7, 7, $3, $3, 9, '2001-01-01', '2001-01-01')
         RETURNING id, version, created_at`,
        [tenant.id, (await addReminded(client, tenant)).round, to.member],
      );
      expect(row.rows[0]?.version).toBe(1);
      expect(row.rows[0]?.created_at.getFullYear()).toBeGreaterThan(2001);
      return row.rows[0]?.id;
    });
    await asRoleIn('app_api', tenant.id, async (client) => {
      const versionOf = async () =>
        (
          await client.query<{ version: number }>(`SELECT version FROM ${TABLE} WHERE id = $1`, [
            id,
          ])
        ).rows[0]?.version;
      await client.query(`UPDATE ${TABLE} SET review_repeat_every_days = 3 WHERE id = $1`, [id]);
      await client.query(`UPDATE ${TABLE} SET review_repeat_every_days = 4 WHERE id = $1`, [id]);
      expect(await versionOf()).toBe(3);
      for (const column of ['version', 'updated_at', 'created_at', 'round_id', 'tenant_id', 'id']) {
        expect(
          await outcome(client, `UPDATE ${TABLE} SET ${column} = ${column} WHERE id = $1`, [id]),
          column,
        ).toBe('42501');
      }
      for (const change of [
        { version: 1 },
        { updated_at: new Date(0) },
        { created_at: new Date(0) },
      ]) {
        expect(await insertAsApi(change), Object.keys(change)[0]).toBe('42501');
      }
    });
    const moved = await asMigratorIn(tenant.id, (client) =>
      outcome(client, `UPDATE ${TABLE} SET round_id = $2 WHERE id = $1`, [id, to.round]),
    );
    expect(moved).toBe('23514');
  });

  it('is read-only for app_worker and deleted by no app role', async () => {
    const id = await asMigratorIn(tenant.id, async (client) =>
      insertRow(client, TABLE, settingRow(tenant, await addReminded(client, tenant))),
    );
    await asRoleIn('app_worker', tenant.id, async (client) => {
      expect((await client.query(`SELECT FROM ${TABLE} WHERE id = $1`, [id])).rowCount).toBe(1);
      expect(
        await outcome(client, `UPDATE ${TABLE} SET draft_enabled = false WHERE id = $1`, [id]),
      ).toBe('42501');
    });
    for (const role of ['app_api', 'app_worker'] as const) {
      await asRoleIn(role, tenant.id, async (client) => {
        expect(await outcome(client, `DELETE FROM ${TABLE} WHERE id = $1`, [id]), role).toBe(
          '42501',
        );
      });
    }
  });
});
