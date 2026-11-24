// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Report definitions, the disclosure rule and publication runs (migration
// 0080): each role holds exactly its column grants, the database sets the
// times, definitions and rules change only with their next version and
// config version (rule 10), an archived report stays as it is, and a run
// moves only along its states, takes only a clean file never linked as its
// output, and is submitted by app_api alone (rule 9).

import { randomUUID } from 'node:crypto';

import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import { insight } from '../../classification/insight.ts';
import { RIGHTS_ROLES, withClient } from '../connect.ts';
import {
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  outcome,
  type Row,
  type TestTenant,
} from '../tenants.ts';
import {
  addInsightParts,
  addRefusedFiles,
  definitionRow,
  insertOutcome,
  ruleRow,
  runRow,
  type InsightParts,
} from './fixtures.ts';

type Role = 'app_api' | 'app_worker';

let tenant: TestTenant;
let parts: InsightParts;
beforeAll(async () => {
  tenant = await createTestTenant();
  parts = await asMigratorIn(tenant.id, (client) => addInsightParts(client, tenant));
}, 60_000);

const as = (role: Role, text: string, values: readonly unknown[] = []) =>
  asRoleIn(role, tenant.id, (client) => outcome(client, text, values));
const insert = (table: string, row: Row) =>
  insertOutcome('app_api', tenant, `insight.${table}`, row);
const added = (table: string, row: Row) =>
  asMigratorIn(tenant.id, (client) => insertRow(client, `insight.${table}`, row));

/** A member of a new tenant of its own, for a table that takes one row a tenant. */
async function ownTenant(): Promise<{ own: TestTenant; member: string }> {
  const own = await createTestTenant();
  const { member } = await asMigratorIn(own.id, (client) => addInsightParts(client, own));
  return { own, member };
}

describe('insight grants', () => {
  const rights = (role: string, privilege: string, table: string, columns: readonly string[]) =>
    columns.map((column) => `${role} ${privilege} ${table}.${column}`);
  // Only app_api, where the disclosure engine runs, reads the run log (ADR 0032).
  const reads = Object.entries(insight).flatMap(([table, columns]) =>
    (table === 'insight.report_run' ? ['app_api'] : ['app_api', 'app_worker']).flatMap((role) =>
      rights(role, 'SELECT', table, Object.keys(columns)),
    ),
  );
  const expected = [
    ...reads,
    ...rights('app_api', 'INSERT', 'insight.report_definition', [
      'tenant_id',
      'kind',
      'name',
      'definition',
      'created_by',
      'updated_by',
    ]),
    ...rights('app_api', 'UPDATE', 'insight.report_definition', [
      'name',
      'definition',
      'version',
      'archived_at',
      'updated_by',
    ]),
    ...rights('app_api', 'INSERT', 'insight.disclosure_rule', [
      'tenant_id',
      'threshold',
      'minimum_group',
      'created_by',
      'updated_by',
    ]),
    ...rights('app_api', 'UPDATE', 'insight.disclosure_rule', [
      'threshold',
      'minimum_group',
      'version',
      'updated_by',
    ]),
    ...rights('app_api', 'INSERT', 'insight.publication_run', [
      'tenant_id',
      'kind',
      'period_start',
      'period_end',
      'prepared_by',
    ]),
    ...rights('app_api', 'UPDATE', 'insight.publication_run', ['state', 'submitted_by']),
    ...rights('app_api', 'INSERT', 'insight.report_run', [
      'tenant_id',
      'report_id',
      'report_version',
      'kind',
      'outcome',
      'disclosure_rule_version',
      'question',
      'breakdown',
      'filter_field',
      'filter_id',
      'filter_year',
      'round_ids',
      'population',
      'shown_table',
      'created_by',
      'updated_by',
    ]),
    ...rights('app_worker', 'UPDATE', 'insight.publication_run', [
      'state',
      'output_file_id',
      'error_code',
    ]),
    'app_api USAGE insight',
    'app_worker USAGE insight',
  ];

  it('are exactly the column grants each role needs, with no table-wide right', async () => {
    const { rows } = await withClient('migrator', (client) =>
      client.query<{ right: string }>(
        `SELECT r.name || ' ' || p.privilege || ' ' || c.oid::regclass::text || '.' || a.attname
                  AS right
           FROM pg_catalog.pg_class c
           JOIN pg_catalog.pg_attribute a
             ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
          CROSS JOIN pg_catalog.unnest($1::text[]) AS r(name)
          CROSS JOIN pg_catalog.unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'])
                AS p(privilege)
          WHERE c.relnamespace = 'insight'::regnamespace AND c.relkind = 'r'
            AND pg_catalog.has_column_privilege(r.name, c.oid, a.attnum, p.privilege)
         UNION ALL
         SELECT r.name || ' ' || p.privilege || ' ' || c.oid::regclass::text
           FROM pg_catalog.pg_class c
          CROSS JOIN pg_catalog.unnest($1::text[]) AS r(name)
          CROSS JOIN pg_catalog.unnest(ARRAY['DELETE', 'TRUNCATE', 'TRIGGER']) AS p(privilege)
          WHERE c.relnamespace = 'insight'::regnamespace AND c.relkind = 'r'
            AND pg_catalog.has_table_privilege(r.name, c.oid, p.privilege)
         UNION ALL
         SELECT r.name || ' USAGE insight'
           FROM pg_catalog.unnest($1::text[]) AS r(name)
          WHERE pg_catalog.has_schema_privilege(r.name, 'insight', 'USAGE')`,
        [[...RIGHTS_ROLES, 'public']],
      ),
    );
    expect(rows.map((row) => row.right).sort()).toEqual(expected.sort());
  });

  it('leave no function that writes a run, a config version or an audit event', async () => {
    const { rows } = await withClient('migrator', (client) =>
      client.query<{ name: string }>(
        `SELECT p.oid::regprocedure::text AS name FROM pg_catalog.pg_proc p
          WHERE p.pronamespace = 'insight'::regnamespace
            AND p.prosrc ~ '(publication_run|config_version|audit_event)'
         UNION ALL
         SELECT p.oid::regprocedure::text FROM pg_catalog.pg_proc p
          WHERE p.pronamespace <> 'insight'::regnamespace AND p.prosrc ~ 'insight[.]'`,
      ),
    );
    expect(rows).toEqual([]);
  });
});

describe('database-set times', { timeout: 30_000 }, () => {
  const past = '2000-01-01T00:00:00Z';

  it('ignore what migrator supplies', async () => {
    const times = await asMigratorIn(tenant.id, async (client) => {
      const stamped = { created_at: past, updated_at: past };
      const definition = await insertRow(
        client,
        'insight.report_definition',
        definitionRow(tenant, parts.member, stamped),
      );
      await client.query('UPDATE insight.report_definition SET archived_at = $2 WHERE id = $1', [
        definition,
        past,
      ]);
      const run = await insertRow(
        client,
        'insight.publication_run',
        runRow(tenant, parts.member, {
          ...stamped,
          state: 'submitted',
          output_file_id: parts.file,
          submitted_by: parts.member,
          submitted_at: past,
        }),
      );
      const read = async (text: string, id: string) =>
        Object.values((await client.query<Record<string, Date>>(text, [id])).rows[0] ?? {});
      return [
        ...(await read(
          'SELECT created_at, updated_at, archived_at FROM insight.report_definition WHERE id = $1',
          definition,
        )),
        ...(await read(
          'SELECT created_at, updated_at, submitted_at FROM insight.publication_run WHERE id = $1',
          run,
        )),
      ];
    });
    expect(times).toHaveLength(6);
    for (const time of times) expect(time.getFullYear()).toBeGreaterThan(2000);
  });

  it('are not granted to app_api', async () => {
    const { own, member } = await ownTenant();
    for (const [table, row] of [
      ['report_definition', definitionRow(own, member)],
      ['disclosure_rule', ruleRow(own, member)],
      ['publication_run', runRow(own, member)],
    ] as const) {
      expect(
        await insertOutcome('app_api', own, `insight.${table}`, { ...row, created_at: past }),
        table,
      ).toBe('42501');
    }
  });
});

/** Change a row and record its config version, in the caller's app_api transaction. */
async function changeWithVersion(
  client: pg.ClientBase,
  table: 'report_definition' | 'disclosure_rule',
  id: string,
  assignments: string,
): Promise<string> {
  const text = `UPDATE insight.${table} SET ${assignments} WHERE id = $1`;
  const changed = await outcome(client, text, [id]);
  if (changed !== 'ok') return changed;
  await client.query(text, [id]);
  await client.query(
    `INSERT INTO app.config_version (tenant_id, entity_type, entity_id, version, author_id, diff)
     SELECT tenant_id, $2, id, version, $3, '{"changes": []}' FROM insight.${table} WHERE id = $1`,
    [id, `insight.${table}`, parts.member],
  );
  return 'ok';
}

/** The config versions recorded for a row, in order. */
async function versions(client: pg.ClientBase, id: string): Promise<number[]> {
  const { rows } = await client.query<{ version: number }>(
    'SELECT version FROM app.config_version WHERE entity_id = $1 ORDER BY version',
    [id],
  );
  return rows.map((row) => row.version);
}

describe('insight.report_definition', { timeout: 30_000 }, () => {
  it('takes a change with its next version and config version, in one transaction', async () => {
    const id = await added('report_definition', definitionRow(tenant, parts.member));
    await asRoleIn('app_api', tenant.id, async (client) => {
      const change = (assignments: string) =>
        changeWithVersion(client, 'report_definition', id, assignments);
      expect(await change("name = 'Renamed report', version = version + 1")).toBe('ok');
      expect(await change(`definition = '{"source": "awards"}', version = version + 1`)).toBe('ok');
      expect(await change("name = 'Again', version = version + 2")).toBe('23514');
      expect(await change("name = 'Again'")).toBe('23514');
      expect(await change('version = version + 1')).toBe('23514');
      expect(await change('version = version - 1')).toBe('23514');
      expect(await versions(client, id)).toEqual([2, 3]);
    });
  });

  it('is archived, never deleted, and then never changes', async () => {
    const id = await added('report_definition', definitionRow(tenant, parts.member));
    const set = (assignments: string) =>
      as('app_api', `UPDATE insight.report_definition SET ${assignments} WHERE id = $1`, [id]);
    expect(await as('app_api', 'DELETE FROM insight.report_definition WHERE id = $1', [id])).toBe(
      '42501',
    );
    expect(await set("kind = 'monitoring'")).toBe('42501');
    expect(await set('archived_at = now()')).toBe('ok');
    await asMigratorIn(tenant.id, (client) =>
      client.query('UPDATE insight.report_definition SET archived_at = now() WHERE id = $1', [id]),
    );
    expect(await set('archived_at = NULL')).toBe('55000');
    expect(await set("name = 'Renamed report', version = version + 1")).toBe('55000');
  });

  it('keeps a name unique among unarchived reports, whatever its case', async () => {
    const name = `Synthetic report ${randomUUID()}`;
    const id = await added('report_definition', definitionRow(tenant, parts.member, { name }));
    const again = definitionRow(tenant, parts.member, { name: name.toUpperCase() });
    expect(await insert('report_definition', again)).toBe('23505');
    await asMigratorIn(tenant.id, (client) =>
      client.query('UPDATE insight.report_definition SET archived_at = now() WHERE id = $1', [id]),
    );
    expect(await insert('report_definition', again)).toBe('ok');
  });

  it('refuses a kind off the list, bad text, and a definition not a small object', async () => {
    const row = (change: Row) =>
      insert('report_definition', definitionRow(tenant, parts.member, change));
    expect(await row({ kind: 'monitoring' })).toBe('ok');
    expect(await row({ kind: 'survey' })).toBe('23514');
    expect(await row({ name: '' })).toBe('23514');
    expect(await row({ name: ' padded' })).toBe('23514');
    expect(await row({ name: 'two\nlines' })).toBe('23514');
    expect(await row({ name: 'n'.repeat(201) })).toBe('23514');
    expect(await row({ definition: JSON.stringify(['source']) })).toBe('23514');
    expect(await row({ definition: { note: 'x'.repeat(65_536) } })).toBe('23514');
  });
});

describe('insight.disclosure_rule', { timeout: 30_000 }, () => {
  it('is one a tenant, at or above the floor, and never deleted', async () => {
    const { own, member } = await ownTenant();
    const row = (change: Row) =>
      insertOutcome('app_api', own, 'insight.disclosure_rule', ruleRow(own, member, change));
    expect(await row({ threshold: 9 })).toBe('23514');
    expect(await row({ minimum_group: 19 })).toBe('23514');
    expect(await row({ threshold: 1001, minimum_group: 2000 })).toBe('23514');
    expect(await row({ minimum_group: 10_001 })).toBe('23514');
    expect(await row({ threshold: 30, minimum_group: 25 })).toBe('23514');
    expect(await row({ threshold: 30, minimum_group: 30 })).toBe('ok');
    const id = await asMigratorIn(own.id, (client) =>
      insertRow(client, 'insight.disclosure_rule', ruleRow(own, member)),
    );
    expect(await row({ threshold: 12 })).toBe('23505');
    expect(
      await asRoleIn('app_api', own.id, (client) =>
        outcome(client, 'DELETE FROM insight.disclosure_rule WHERE id = $1', [id]),
      ),
    ).toBe('42501');
  });

  it('takes a change with its next version and config version, in one transaction', async () => {
    const id = await added('disclosure_rule', ruleRow(tenant, parts.member));
    await asRoleIn('app_api', tenant.id, async (client) => {
      const change = (assignments: string) =>
        changeWithVersion(client, 'disclosure_rule', id, assignments);
      expect(await change('threshold = 12, version = version + 1')).toBe('ok');
      expect(await change('threshold = 15')).toBe('23514');
      expect(await change('minimum_group = 30, version = version + 2')).toBe('23514');
      expect(await change('version = version + 1')).toBe('23514');
      expect(await change('threshold = 9, version = version + 1')).toBe('23514');
      expect(await change('minimum_group = 30, version = version + 1')).toBe('ok');
      expect(await versions(client, id)).toEqual([2, 3]);
    });
  });
});

describe('insight.publication_run', { timeout: 60_000 }, () => {
  const run = (change: Row = {}) => added('publication_run', runRow(tenant, parts.member, change));
  const prepared = () => run({ state: 'prepared', output_file_id: parts.file });
  const update = (role: Role, id: string, assignments: string) =>
    as(role, `UPDATE insight.publication_run SET ${assignments} WHERE id = $1`, [id]);

  it('checks its kind and period, and starts as preparing', async () => {
    const row = (change: Row) => insert('publication_run', runRow(tenant, parts.member, change));
    expect(await row({})).toBe('ok');
    expect(await row({ kind: 'sorp_grant_note' })).toBe('ok');
    expect(await row({ kind: 'charity_commission' })).toBe('23514');
    expect(await row({ period_end: '2026-04-01' })).toBe('23514');
    expect(await row({ state: 'prepared' })).toBe('42501');
  });

  it('is prepared or failed by app_worker, with its output or an error code', async () => {
    const preparing = await run();
    const file = `'${parts.file}'`;
    expect(await update('app_worker', preparing, "state = 'prepared'")).toBe('23514');
    expect(await update('app_worker', preparing, `output_file_id = ${file}`)).toBe('23514');
    expect(
      await update('app_worker', preparing, `state = 'prepared', output_file_id = ${file}`),
    ).toBe('ok');
    expect(await update('app_worker', preparing, "state = 'failed'")).toBe('23514');
    expect(
      await update('app_worker', preparing, "state = 'failed', error_code = 'Not a code'"),
    ).toBe('23514');
    expect(
      await update('app_worker', preparing, "state = 'failed', error_code = 'source_unavailable'"),
    ).toBe('ok');
    expect(await update('app_api', preparing, "state = 'failed'")).toBe('23514');
    expect(await update('app_worker', preparing, "state = 'submitted'")).toBe('55000');
  });

  it('takes as its output only a clean file that was never linked', async () => {
    const files = await asMigratorIn(tenant.id, (client) =>
      addRefusedFiles(client, tenant, parts.member),
    );
    const preparing = await run();
    const take = (file: string) =>
      update('app_worker', preparing, `state = 'prepared', output_file_id = '${file}'`);
    for (const [kind, file] of Object.entries(files)) {
      expect(await take(file), kind).toBe('55000');
    }
    const fresh = await asMigratorIn(tenant.id, (client) => addInsightParts(client, tenant));
    expect(await take(fresh.file)).toBe('ok');
  });

  it('is submitted by app_api with a member, and never by app_worker', async () => {
    const id = await prepared();
    expect(await update('app_worker', id, "state = 'submitted'")).toBe('23514');
    expect(await update('app_api', id, "state = 'submitted'")).toBe('23514');
    expect(await update('app_api', id, 'submitted_at = now()')).toBe('42501');
    const submittedAt = await asRoleIn('app_api', tenant.id, async (client) => {
      await client.query(
        "UPDATE insight.publication_run SET state = 'submitted', submitted_by = $2 WHERE id = $1",
        [id, parts.member],
      );
      const { rows } = await client.query<{ submitted_at: Date | null }>(
        'SELECT submitted_at FROM insight.publication_run WHERE id = $1',
        [id],
      );
      return rows[0]?.submitted_at;
    });
    expect(submittedAt).toBeInstanceOf(Date);
  });

  it('moves only along its states, and keeps what it was given', async () => {
    const other = await asMigratorIn(tenant.id, (client) => addInsightParts(client, tenant));
    const preparing = await run();
    const ready = await prepared();
    const failed = await run({ state: 'failed', error_code: 'source_unavailable' });
    const submitted = await run({
      state: 'submitted',
      output_file_id: parts.file,
      submitted_by: parts.member,
    });
    for (const [role, id, assignments] of [
      ['app_api', ready, "state = 'preparing'"],
      ['app_worker', ready, "state = 'failed', output_file_id = NULL, error_code = 'late'"],
      ['app_worker', ready, `output_file_id = '${other.file}'`],
      ['app_worker', failed, "state = 'preparing', error_code = NULL"],
      ['app_worker', failed, "error_code = 'other_code'"],
      ['app_api', submitted, "state = 'prepared', submitted_by = NULL"],
      ['app_api', submitted, `submitted_by = '${other.member}'`],
    ] as const) {
      expect(await update(role, id, assignments), assignments).toBe('55000');
    }
    expect(await update('app_api', submitted, "state = 'submitted'")).toBe('ok');
    const asMigrator = (assignments: string) =>
      asMigratorIn(tenant.id, (client) =>
        outcome(client, `UPDATE insight.publication_run SET ${assignments} WHERE id = $1`, [
          preparing,
        ]),
      );
    expect(await asMigrator("kind = 'annual_return'")).toBe('55000');
    expect(await asMigrator("period_end = '2027-12-31'")).toBe('55000');
    expect(await asMigrator(`prepared_by = '${other.member}'`)).toBe('55000');
    for (const role of ['app_api', 'app_worker'] as const) {
      expect(await as(role, 'DELETE FROM insight.publication_run WHERE id = $1', [ready])).toBe(
        '42501',
      );
    }
  });
});
