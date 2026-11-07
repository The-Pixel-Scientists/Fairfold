// SPDX-License-Identifier: AGPL-3.0-or-later
//
// app.apply_retention(policy) (migration 0032): only app_worker may call
// it, only with a tenant set, and never for audit, which
// app.purge_expired_audit() applies. ADR 0003 approves it, as rule 7
// requires of every definer function. Its targets agree with the
// classification map: every column with a tenant_policy rule other than
// audit is in exactly one target, the function names no other table, and
// its owner may write only its targets' columns and never a decision,
// status or stage (rule 9).
//
// No column has such a rule yet, so TARGETS is empty and the function
// refuses every policy. A migration that adds one adds its targets to the
// function and TARGETS, with tests that it acts only past the tenant's
// setting (or the minimum), in its batch size, in the tenant set, and
// writes its audit event.

import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { classification } from '../../classification.ts';
import { APP_ROLES, withClient } from '../connect.ts';
import { heldRights } from '../privilege-lint.ts';
import { asRoleIn, createTestTenant, outcome } from '../tenants.ts';

interface Target {
  readonly policy: string;
  readonly table: string;
  /** Delete rows whose table is wholly under the policy; anonymise a referenced row (ADR 0027). */
  readonly action: 'delete' | 'anonymise';
  readonly columns: readonly string[];
}

const TARGETS: readonly Target[] = [];

const FUNCTION = 'app.apply_retention(text)';
const OWNER = 'owner_app_apply_retention';
const CALL = 'SELECT * FROM app.apply_retention($1)';
const ADR_0003 = new URL(
  '../../../../docs/adr/0003-query-builder-and-migrations.md',
  import.meta.url,
);

/** "<policy> <table>.<column>" for each column under a tenant_policy other than audit. */
const mapColumns = Object.entries(classification).flatMap(([table, columns]) =>
  Object.entries(columns).flatMap(([column, { retention }]) =>
    retention.kind === 'tenant_policy' && retention.policy !== 'audit'
      ? [`${retention.policy} ${table}.${column}`]
      : [],
  ),
);

describe('app.apply_retention', { timeout: 30_000 }, () => {
  it('may be called by app_worker alone', async () => {
    await withClient('migrator', async (client) => {
      const { rows } = await client.query<{ role: string }>(
        `SELECT r.role FROM pg_catalog.unnest($1::text[]) AS r(role)
          WHERE pg_catalog.has_function_privilege(r.role, $2, 'EXECUTE')`,
        [APP_ROLES, FUNCTION],
      );
      expect(rows.map(({ role }) => role)).toEqual(['app_worker']);
    });
    const tenant = await createTestTenant();
    await asRoleIn('app_api', tenant.id, async (client) => {
      expect(await outcome(client, CALL, ['audit'])).toBe('42501');
    });
  });

  it('is an approved definer function in ADR 0003, callable by app_worker alone', async () => {
    const adr = await readFile(ADR_0003, 'utf8');
    const approved = adr.split('### Approved definer functions')[1]?.split('\n### ')[0] ?? '';
    const row = approved.split('\n').find((line) => line.startsWith('| `app.apply_retention('));
    expect(row, 'ADR 0003 does not approve app.apply_retention()').toBeDefined();
    expect(row?.split('|')[2]?.match(/`[a-z_]+`/g)).toEqual(['`app_worker`']);
  });

  it('refuses a call with no tenant set', async () => {
    await withClient('app_worker', async (client) => {
      await client.query('BEGIN');
      expect(await outcome(client, CALL, ['audit'])).toBe('55000');
      await client.query('ROLLBACK');
    });
  });

  it('refuses audit, which the audit purge applies, and every policy without targets', async () => {
    const tenant = await createTestTenant();
    await asRoleIn('app_worker', tenant.id, async (client) => {
      for (const policy of ['audit', 'documents', '']) {
        expect(await outcome(client, CALL, [policy]), policy).toBe('22023');
      }
    });
  });

  it('has exactly one target for each column the map puts under a policy', () => {
    const targeted = TARGETS.flatMap(({ policy, table, columns }) =>
      columns.map((column) => `${policy} ${table}.${column}`),
    );
    expect(new Set(targeted).size).toBe(targeted.length);
    expect(targeted.sort()).toEqual([...mapColumns].sort());
  });

  it('names no table but its targets', async () => {
    const { rows } = await withClient('migrator', (client) =>
      client.query<{ source: string }>(
        'SELECT pg_catalog.pg_get_functiondef($1::regprocedure) AS source',
        [FUNCTION],
      ),
    );
    const schemas = new Set(Object.keys(classification).map((table) => table.split('.')[0]));
    const named = [...(rows[0]?.source ?? '').matchAll(/\b([a-z_]+)\.([a-z_]+)\b(?!\s*\()/g)]
      .filter(([, schema]) => schemas.has(schema ?? ''))
      .map(([table]) => table);
    const allowed = new Set(TARGETS.map(({ table }) => table));
    expect(named.filter((table) => !allowed.has(table))).toEqual([]);
  });

  it('lets its owner write only its targets, and never a decision, status or stage', async () => {
    const rights = await withClient('migrator', (client) => heldRights(client, [OWNER]));
    const writes = rights
      .filter(({ privilege }) => ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'].includes(privilege))
      .map(({ privilege, object }) => `${privilege} on ${object}`);
    const allowed = TARGETS.flatMap(({ table, action, columns }) =>
      action === 'delete'
        ? [`DELETE on ${table}`]
        : columns.map((column) => `UPDATE on column ${table}.${column}`),
    );
    expect(writes.filter((right) => !allowed.includes(right))).toEqual([]);
    expect(writes.filter((right) => /\.(status|decision|stage|outcome)\w*$/.test(right))).toEqual(
      [],
    );
  });
});
