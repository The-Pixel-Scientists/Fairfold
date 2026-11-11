// SPDX-License-Identifier: AGPL-3.0-or-later
//
// crm.merge_record (migration 0063, ADR 0025): append-only for every app
// role, written by app_api alone with a named member (rule 9), between two
// parties of its kind that it keeps pointing at. Until ADR 0025 is accepted
// with the rows a reversal needs, every record is a merge: an unmerge, of a
// merge or of another unmerge, is refused. Nothing in the database writes one.

import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import { RIGHTS_ROLES, withClient, withRoleClient } from '../connect.ts';
import { addParty } from '../party/fixtures.ts';
import { asMigratorIn, createTestTenant, insertRow, outcome, type TestTenant } from '../tenants.ts';
import { addCrmParts, insertOutcome, mergeRow, type CrmParts } from './fixtures.ts';

let tenant: TestTenant;
let parts: CrmParts;
let loser: string;
let merge: string;
beforeAll(async () => {
  tenant = await createTestTenant();
  await asMigratorIn(tenant.id, async (client) => {
    parts = await addCrmParts(client, tenant);
    // A party with no person row, so that only crm's key can hold it.
    loser = await addParty(client, tenant, 'person');
    merge = await insertRow(
      client,
      'crm.merge_record',
      mergeRow(tenant, loser, parts.person, parts.member, { merged_at: '2000-01-01T00:00:00Z' }),
    );
  });
}, 60_000);

const add = (change: Record<string, unknown> = {}) =>
  insertOutcome('app_api', tenant, 'crm.merge_record', {
    ...mergeRow(tenant, loser, parts.person, parts.member),
    ...change,
  });

async function inTenant(client: pg.ClientBase, statement: string): Promise<string> {
  await client.query('BEGIN');
  try {
    await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [tenant.id]);
    return await outcome(client, statement, [merge]);
  } finally {
    await client.query('ROLLBACK');
  }
}

describe('crm.merge_record', { timeout: 60_000 }, () => {
  it('sets merged_at itself', async () => {
    const { rows } = await asMigratorIn(tenant.id, (client) =>
      client.query<{ merged_at: Date }>('SELECT merged_at FROM crm.merge_record WHERE id = $1', [
        merge,
      ]),
    );
    expect(rows[0]?.merged_at.getFullYear()).toBeGreaterThan(2000);
  });

  it('is append-only for every app role, and app_worker cannot add one', async () => {
    for (const role of RIGHTS_ROLES) {
      await withRoleClient(role, async (client) => {
        for (const statement of [
          "UPDATE crm.merge_record SET repointed_counts = '{}' WHERE id = $1",
          'DELETE FROM crm.merge_record WHERE id = $1',
        ]) {
          expect(await inTenant(client, statement), `${role}: ${statement}`).toBe('42501');
        }
      });
    }
    expect(
      await insertOutcome(
        'app_worker',
        tenant,
        'crm.merge_record',
        mergeRow(tenant, loser, parts.person, parts.member),
      ),
    ).toBe('42501');
  });

  it('needs a member, two parties of its kind and a preview for a merge', async () => {
    expect(await add()).toBe('ok');
    expect(await add({ merged_by: null })).toBe('23502');
    expect(await add({ survivor_id: loser })).toBe('23514');
    expect(await add({ survivor_id: parts.organisation })).toBe('23503');
    expect(await add({ preview_hash: null })).toBe('23502');
    expect(await add({ preview_hash: 'A'.repeat(64) })).toBe('23514');
    expect(
      await add({ repointed_counts: JSON.stringify({ crm: { 'crm.interaction': -1 } }) }),
    ).toBe('23514');
    expect(await add({ repointed_counts: JSON.stringify({ crm: { id: 'x' } }) })).toBe('23514');
    expect(await add({ repointed_counts: JSON.stringify({ nope: {} }) })).toBe('23514');
  });

  it('refuses every unmerge, so no record reverses another', async () => {
    expect(await add({ action: 'unmerge' })).toBe('23514');
    expect(
      await asMigratorIn(tenant.id, (client) =>
        outcome(
          client,
          `INSERT INTO crm.merge_record
             (tenant_id, kind, action, loser_id, survivor_id, repointed_counts, preview_hash,
              merged_by)
           SELECT tenant_id, kind, 'unmerge', survivor_id, loser_id, repointed_counts,
                  preview_hash, merged_by
             FROM crm.merge_record WHERE id = $1`,
          [merge],
        ),
      ),
    ).toBe('23514');
    const { rows } = await withClient('migrator', (client) =>
      client.query(
        `SELECT FROM pg_catalog.pg_attribute
          WHERE attrelid = 'crm.merge_record'::regclass AND attname = 'reverses_id'`,
      ),
    );
    expect(rows).toEqual([]);
  });

  it('keeps the loser from being deleted', async () => {
    const code = await asMigratorIn(tenant.id, (client) =>
      outcome(client, 'DELETE FROM party.party WHERE id = $1', [loser]),
    );
    expect(code).toBe('23503');
  });

  it('is written by no function or trigger in the database', async () => {
    const { rows } = await withClient('migrator', (client) =>
      client.query<{ name: string }>(
        `SELECT p.oid::pg_catalog.regprocedure::text AS name FROM pg_catalog.pg_proc p
          WHERE p.prosrc ILIKE '%merge\\_record%'`,
      ),
    );
    expect(rows).toEqual([]);
  });
});
