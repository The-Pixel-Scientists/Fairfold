// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Migration 0068 (B10-01, rule 8): a reminder setting or reminder email
// points only at a template version of its own reminder kind, never at a
// decision template or the other kind's, and no role sets the kind a setting
// requires. Its down keeps every reminder template and the rows that use
// them, and its up then applies again.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS_FOLDER } from '../../scripts/migrations.ts';
import { asMigratorRolledBack } from '../connect.ts';
import { templateRow } from '../grants/fixtures.ts';
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
import {
  addReminded,
  draftReminder,
  type Reminded,
  reviewReminder,
  settingRow,
} from './fixtures.ts';

const MIGRATION = join(MIGRATIONS_FOLDER, '0068_grants_reminder_template_kind');

let tenant: TestTenant;
let to: Reminded;

beforeAll(async () => {
  tenant = await createTestTenant();
  to = await asMigratorIn(tenant.id, (client) => addReminded(client, tenant));
}, 60_000);

describe('reminder template kinds', { timeout: 30_000 }, () => {
  it('lets app_api add a template for each reminder kind', async () => {
    for (const kind of ['draft_closing', 'review_overdue']) {
      const row = templateRow(tenant, to.programme, { outcome: kind, version: 2 });
      expect(
        await insertOutcome('app_api', tenant, 'grants.email_template_version', row),
        kind,
      ).toBe('ok');
    }
  });

  it.each([
    ['a decision template for drafts', 'draft_template_version_id', 'decisionTemplate'],
    ['the review template for drafts', 'draft_template_version_id', 'reviewTemplate'],
    ['a decision template for reviews', 'review_template_version_id', 'decisionTemplate'],
    ['the draft template for reviews', 'review_template_version_id', 'draftTemplate'],
  ] as const)('refuses a setting with %s', async (_, column, template) => {
    const row = settingRow(tenant, to, { [column]: to[template] });
    expect(await insertOutcome('app_api', tenant, 'grants.reminder_setting', row)).toBe('23503');
  });

  it('refuses an update of a setting to a decision template', () =>
    asRoleIn('app_api', tenant.id, async (client) => {
      const id = await insertRow(client, 'grants.reminder_setting', settingRow(tenant, to));
      for (const column of ['draft_template_version_id', 'review_template_version_id']) {
        expect(
          await outcome(client, `UPDATE grants.reminder_setting SET ${column} = $2 WHERE id = $1`, [
            id,
            to.decisionTemplate,
          ]),
          column,
        ).toBe('23503');
      }
    }));

  it('sets the kinds a setting requires, which no role writes, even migrator', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const id = await insertRow(client, 'grants.reminder_setting', settingRow(tenant, to));
      const { rows } = await client.query(
        `SELECT draft_template_kind, review_template_kind FROM grants.reminder_setting
          WHERE id = $1`,
        [id],
      );
      expect(rows).toEqual([
        { draft_template_kind: 'draft_closing', review_template_kind: 'review_overdue' },
      ]);
    });
    await asMigratorIn(tenant.id, async (client) => {
      for (const column of ['draft_template_kind', 'review_template_kind']) {
        expect(
          await outcome(client, `UPDATE grants.reminder_setting SET ${column} = 'accepted'`),
          column,
        ).toBe('428C9');
        const { text, values } = insertStatement(
          client,
          'grants.reminder_setting',
          settingRow(tenant, to, { [column]: 'accepted' }),
        );
        expect(await outcome(client, text, values), column).toBe('428C9');
      }
    });
  });

  it.each([
    ['a draft reminder from a decision template', draftReminder, 'decisionTemplate'],
    ['a draft reminder from the review template', draftReminder, 'reviewTemplate'],
    ['a review reminder from a decision template', reviewReminder, 'decisionTemplate'],
    ['a review reminder from the draft template', reviewReminder, 'draftTemplate'],
  ] as const)('refuses %s', async (_, reminder, template) => {
    const row = reminder(tenant, to, { template_version_id: to[template] });
    expect(await insertOutcome('app_worker', tenant, 'grants.reminder_email', row)).toBe('23503');
  });

  it('keeps reminder templates and the rows using them on the way down, then applies again', async () => {
    const down = await readFile(join(MIGRATION, 'down.sql'), 'utf8');
    const up = await readFile(join(MIGRATION, 'up.sql'), 'utf8');
    const other = await createTestTenant();
    await asMigratorRolledBack(async (client) => {
      await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [other.id]);
      const used = await addReminded(client, other);
      const setting = await insertRow(client, 'grants.reminder_setting', settingRow(other, used));
      const reminder = await insertRow(client, 'grants.reminder_email', draftReminder(other, used));
      const validated = async () =>
        (
          await client.query<{ convalidated: boolean }>(
            `SELECT convalidated FROM pg_catalog.pg_constraint
              WHERE conrelid = 'grants.email_template_version'::regclass
                AND conname = 'email_template_version_outcome_check'`,
          )
        ).rows[0]?.convalidated;

      await client.query(down);
      expect(await validated()).toBe(false);
      const kept = await client.query(
        `SELECT FROM grants.reminder_setting s, grants.reminder_email e
          WHERE s.id = $1 AND s.draft_template_version_id = $3
            AND e.id = $2 AND e.template_version_id = $3`,
        [setting, reminder, used.draftTemplate],
      );
      expect(kept.rowCount).toBe(1);
      const { text, values } = insertStatement(
        client,
        'grants.email_template_version',
        templateRow(other, used.programme, { outcome: 'draft_closing', version: 2 }),
      );
      expect(await outcome(client, text, values)).toBe('23514');

      await client.query(up);
      expect(await validated()).toBe(true);
      expect(
        await outcome(
          client,
          'UPDATE grants.reminder_setting SET draft_template_version_id = $2 WHERE id = $1',
          [setting, used.decisionTemplate],
        ),
      ).toBe('23503');
    });
  });
});
