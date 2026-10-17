// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The grants schema (migration 0009): who may use it and delete from it,
// and grants.programme and grants.round: isolation, what app_api may write,
// and each check.

import { beforeAll, describe, expect, it } from 'vitest';

import { APP_ROLES, withClient } from '../connect.ts';
import { expectCrossTenantDenial } from '../cross-tenant.ts';
import {
  addMember,
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertStatement,
  outcome,
  type Row,
  type TestTenant,
} from '../tenants.ts';
import { addProgramme, programmeRow, PROGRAMME_TABLES, roundRow } from './fixtures.ts';

const MAX_AMOUNT_MINOR = 100_000_000_000;

/** A tenant with a member and a programme, a member of another tenant and their programme. */
let tenant: TestTenant;
let member: string;
let programme: string;
let stranger: string;
let strangersProgramme: string;
beforeAll(async () => {
  tenant = await createTestTenant();
  const other = await createTestTenant();
  [member, programme] = await asMigratorIn(tenant.id, async (client) => [
    await addMember(client, tenant),
    await addProgramme(client, tenant),
  ]);
  [stranger, strangersProgramme] = await asMigratorIn(other.id, async (client) => [
    await addMember(client, other),
    await addProgramme(client, other),
  ]);
}, 30_000);

/** `change` with '<stranger>' and '<strangers programme>' put in. */
function resolved(change: Row): Row {
  const ids: Readonly<Record<string, string>> = {
    '<stranger>': stranger,
    '<strangers programme>': strangersProgramme,
  };
  return Object.fromEntries(
    Object.entries(change).map(([column, value]) => [
      column,
      typeof value === 'string' ? (ids[value] ?? value) : value,
    ]),
  );
}

describe('the grants schema', { timeout: 30_000 }, () => {
  it('is owned by migrator, and only app_api may use it', async () => {
    const { rows } = await withClient('app_api', (client) =>
      client.query<{ owner: string; users: string[] }>(
        `SELECT n.nspowner::regrole::text AS owner,
                ARRAY(SELECT r.role FROM pg_catalog.unnest($1::text[]) AS r(role)
                       WHERE pg_catalog.has_schema_privilege(r.role, n.oid, 'USAGE')
                       ORDER BY 1) AS users
           FROM pg_catalog.pg_namespace n WHERE n.nspname = 'grants'`,
        [APP_ROLES],
      ),
    );
    expect(rows).toEqual([{ owner: 'migrator', users: ['app_api'] }]);
  });

  it('lets app_api alone delete, and only stages and criteria; the rest have a restrictive false policy', async () => {
    const { rows } = await withClient('app_api', (client) =>
      client.query<{ table: string; deleters: string[]; denied: string[] }>(
        `SELECT t.name AS table,
                ARRAY(SELECT r.role FROM pg_catalog.unnest($1::text[]) AS r(role)
                       WHERE pg_catalog.has_table_privilege(r.role, t.name::regclass, 'DELETE')
                       ORDER BY 1) AS deleters,
                ARRAY(SELECT p.polname::text FROM pg_catalog.pg_policy p
                       WHERE p.polrelid = t.name::regclass AND NOT p.polpermissive
                         AND p.polroles @> ARRAY(SELECT r::regrole::oid
                                                   FROM pg_catalog.unnest($1::text[]) AS r)
                       ORDER BY 1) AS denied
           FROM pg_catalog.unnest($2::text[]) AS t(name)
          ORDER BY 1`,
        [APP_ROLES, PROGRAMME_TABLES],
      ),
    );
    expect(rows).toEqual([
      {
        table: 'grants.email_template_version',
        deleters: [],
        denied: ['deny_delete', 'deny_update'],
      },
      { table: 'grants.programme', deleters: [], denied: ['deny_delete'] },
      { table: 'grants.round', deleters: [], denied: ['deny_delete'] },
      { table: 'grants.rubric_criterion', deleters: ['app_api'], denied: [] },
      { table: 'grants.stage', deleters: ['app_api'], denied: [] },
    ]);

    await asRoleIn('app_api', tenant.id, async (client) => {
      for (const table of ['grants.programme', 'grants.round']) {
        expect(await outcome(client, `DELETE FROM ${table}`), table).toBe('42501');
      }
    });
  });
});

describe('grants.programme', { timeout: 30_000 }, () => {
  it("keeps each tenant's programmes from every other tenant", async () => {
    await expectCrossTenantDenial('grants.programme', (_, owner) => programmeRow(owner));
  });

  it('lets app_api add programmes and change their text and status, but not their id or tenant', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const { text, values } = insertStatement(
        client,
        'grants.programme',
        programmeRow(tenant, { created_by: member, updated_by: member }),
      );
      const added = await client.query<{ id: string }>(
        `${text} RETURNING id, status, description`,
        values,
      );
      expect(added.rows[0]).toMatchObject({ status: 'draft', description: '' });

      const changed = await client.query(
        `UPDATE grants.programme
            SET title = 'Green Spaces Fund', summary = 'For growing groups.',
                description = 'Line one.\nLine two.', status = 'open', updated_by = $2
          WHERE id = $1 RETURNING status`,
        [added.rows[0]?.id, member],
      );
      expect(changed.rows).toEqual([{ status: 'open' }]);

      for (const change of ['id = id', 'tenant_id = tenant_id', 'created_by = NULL']) {
        expect(await outcome(client, `UPDATE grants.programme SET ${change}`), change).toBe(
          '42501',
        );
      }
    });
  });

  it.each([
    ['accepts a description with line breaks', { description: 'One.\n\nTwo.' }, 'ok'],
    ['accepts each status', { status: 'closed' }, 'ok'],
    ['refuses an empty title', { title: '' }, '23514'],
    ['refuses a title over 120 characters', { title: 'T'.repeat(121) }, '23514'],
    ['refuses an untrimmed title', { title: 'Fund ' }, '23514'],
    ['refuses a title with a line break', { title: 'Community\nFund' }, '23514'],
    ['refuses an empty summary', { summary: '' }, '23514'],
    ['refuses a summary over 300 characters', { summary: 'S'.repeat(301) }, '23514'],
    ['refuses a summary with a bidi override', { summary: 'Fund \u202eevil' }, '23514'],
    ['refuses a description over 5000 characters', { description: 'D'.repeat(5001) }, '23514'],
    ['refuses a description ending in a line break', { description: 'Text\n' }, '23514'],
    ['refuses a description with a carriage return', { description: 'A\r\nB' }, '23514'],
    ['refuses an unknown status', { status: 'archived' }, '23514'],
    ['refuses a creator from another tenant', { created_by: '<stranger>' }, '23503'],
  ])('%s', async (_, change: Row, expected) => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const { text, values } = insertStatement(
        client,
        'grants.programme',
        programmeRow(tenant, resolved(change)),
      );
      expect(await outcome(client, text, values)).toBe(expected);
    });
  });
});

describe('grants.round', { timeout: 30_000 }, () => {
  it("keeps each tenant's rounds from every other tenant", async () => {
    await expectCrossTenantDenial('grants.round', async (client, owner) =>
      roundRow(owner, await addProgramme(client, owner)),
    );
  });

  it('lets app_api add and change rounds, but not move them or change their currency', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const { text, values } = insertStatement(
        client,
        'grants.round',
        roundRow(tenant, programme, { currency: 'GBP', created_by: member }),
      );
      const added = await client.query<{ id: string }>(`${text} RETURNING id`, values);

      const changed = await client.query(
        `UPDATE grants.round
            SET title = 'Autumn 2027', opens_at = '2027-09-01T08:00:00Z',
                closes_at = '2027-10-31T12:00:00Z', timezone = 'Europe/Dublin',
                budget_minor = 9000000, award_min_minor = 50000, award_max_minor = 3000000,
                late_policy = 'accept_and_flag', updated_by = $2
          WHERE id = $1 RETURNING budget_minor`,
        [added.rows[0]?.id, member],
      );
      expect(changed.rows).toEqual([{ budget_minor: '9000000' }]);

      for (const change of ['programme_id = programme_id', "currency = 'GBP'", 'id = id']) {
        expect(await outcome(client, `UPDATE grants.round SET ${change}`), change).toBe('42501');
      }
    });
  });

  it.each([
    [
      'accepts the largest amounts',
      { budget_minor: MAX_AMOUNT_MINOR, award_max_minor: MAX_AMOUNT_MINOR },
      'ok',
    ],
    ['accepts an award range of one amount', { award_min_minor: 100, award_max_minor: 100 }, 'ok'],
    ['accepts a budget of the largest award', { budget_minor: 2_500_000 }, 'ok'],
    ['accepts late applications flagged', { late_policy: 'accept_and_flag' }, 'ok'],
    ['refuses a closing time at the opening time', { closes_at: '2027-02-02T09:00:00Z' }, '23514'],
    ['refuses a closing time before the opening', { closes_at: '2027-01-01T09:00:00Z' }, '23514'],
    ['refuses a zone that is not a name', { timezone: 'Europe/London; DROP' }, '23514'],
    ['refuses a budget of nothing', { budget_minor: 0 }, '23514'],
    ['refuses a negative award minimum', { award_min_minor: -1 }, '23514'],
    ['refuses an amount over the bound', { budget_minor: MAX_AMOUNT_MINOR + 1 }, '23514'],
    ['refuses an award maximum below the minimum', { award_max_minor: 99_999 }, '23514'],
    ['refuses a budget below the award maximum', { budget_minor: 2_499_999 }, '23514'],
    ['refuses a currency other than GBP', { currency: 'EUR' }, '23514'],
    ['refuses an unknown late policy', { late_policy: 'accept' }, '23514'],
    ['refuses an empty title', { title: '' }, '23514'],
    ['refuses a title with a zero-width space', { title: 'Spring\u200b2027' }, '23514'],
    ['refuses no late policy', { late_policy: null }, '23502'],
    ["refuses another tenant's programme", { programme_id: '<strangers programme>' }, '23503'],
    ['refuses an updater from another tenant', { updated_by: '<stranger>' }, '23503'],
  ])('%s', async (_, change: Row, expected) => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const { text, values } = insertStatement(
        client,
        'grants.round',
        roundRow(tenant, programme, resolved(change)),
      );
      expect(await outcome(client, text, values)).toBe(expected);
    });
  });
});
