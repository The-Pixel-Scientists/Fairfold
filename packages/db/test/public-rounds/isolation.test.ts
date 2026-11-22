// SPDX-License-Identifier: AGPL-3.0-or-later
//
// grants.public_open_rounds() (migration 0071, ADR 0035): one tenant's slug
// never reaches another's rounds, whatever tenant is set; it returns exactly
// the contract's columns, typed as their sources; only app_api runs it; its
// owner cannot log in; and a caller's search_path changes nothing.

import { beforeAll, describe, expect, it } from 'vitest';

import { asMigratorRolledBack, withClient } from '../connect.ts';
import { outcome, type Row } from '../tenants.ts';
import { addOpenRound, createGrantsTenant, type GrantsTenant, roundIds } from './fixtures.ts';

const SIGNATURE = 'grants.public_open_rounds(text)';
const OWNER = 'owner_grants_public_open_rounds';

/** Each result column but the eligibility summary, and the column it is copied from. */
const SOURCES: Readonly<Record<string, string>> = {
  round_id: 'grants.round.id',
  programme_title: 'grants.programme.title',
  programme_summary: 'grants.programme.summary',
  round_title: 'grants.round.title',
  opens_at: 'grants.round.opens_at',
  closes_at: 'grants.round.closes_at',
  timezone: 'grants.round.timezone',
  award_min_minor: 'grants.round.award_min_minor',
  award_max_minor: 'grants.round.award_max_minor',
  currency: 'grants.round.currency',
};

/** Words no result column may contain (S12-48's never-returned list). */
const FORBIDDEN = [
  'tenant',
  'programme_id',
  'description',
  'budget',
  'late',
  'status',
  'stage',
  'rubric',
  'template',
  'definition',
  'count',
  'config',
  'member',
  'user',
  'party',
  'decision',
  'review',
];

let a: GrantsTenant;
let b: GrantsTenant;
let roundA: string;
let roundB: string;

beforeAll(async () => {
  [a, b] = await Promise.all([createGrantsTenant(), createGrantsTenant()]);
  [roundA, roundB] = await Promise.all([addOpenRound(a), addOpenRound(b)]);
}, 60_000);

/** Each role's SQLSTATE, or ok, calling the function with no tenant set. */
async function callers(): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const role of ['app_api', 'app_auth', 'app_worker', 'app_queue'] as const) {
    result[role] = await withClient(role, async (client) => {
      await client.query('BEGIN');
      try {
        return await outcome(client, 'SELECT * FROM grants.public_open_rounds($1)', [a.slug]);
      } finally {
        await client.query('ROLLBACK');
      }
    });
  }
  return result;
}

describe('grants.public_open_rounds() isolation and privileges', { timeout: 60_000 }, () => {
  it("returns only the slug's tenant's rounds, with no tenant set or the other one set", async () => {
    expect(await roundIds(a.slug)).toEqual([roundA]);
    expect(await roundIds(b.slug)).toEqual([roundB]);
    expect(await roundIds(a.slug, b.id)).toEqual([roundA]);
    expect(await roundIds(b.slug, a.id)).toEqual([roundB]);
  });

  it('leaves app_api seeing no grants rows directly with no tenant set', async () => {
    const counts = await withClient('app_api', async (client) => {
      const { rows } = await client.query<Row>(
        `SELECT (SELECT count(*) FROM grants.programme) AS programmes,
                (SELECT count(*) FROM grants.round) AS rounds,
                (SELECT count(*) FROM grants.form_version) AS forms`,
      );
      return rows[0];
    });
    expect(counts).toEqual({ programmes: '0', rounds: '0', forms: '0' });
  });

  it("returns exactly the contract's columns, typed as their sources", async () => {
    const { result, sources } = await withClient('app_api', async (client) => {
      const columns = await client.query<{ name: string; type: string }>(
        `SELECT a.name, pg_catalog.format_type(a.type, NULL) AS type
           FROM pg_catalog.pg_proc p,
                ROWS FROM (pg_catalog.unnest(p.proargnames), pg_catalog.unnest(p.proallargtypes),
                           pg_catalog.unnest(p.proargmodes)) AS a(name, type, mode)
          WHERE p.oid = $1::regprocedure AND a.mode = 't'`,
        [SIGNATURE],
      );
      const types = await client.query<{ name: string; type: string }>(
        `SELECT s.name, pg_catalog.format_type(t.atttypid, NULL) AS type
           FROM pg_catalog.jsonb_each_text($1::jsonb) AS s(name, source)
           JOIN pg_catalog.pg_attribute t
             ON t.attrelid = pg_catalog.regexp_replace(s.source, '\\.[^.]+$', '')::regclass
            AND t.attname = pg_catalog.split_part(s.source, '.', 3)`,
        [JSON.stringify(SOURCES)],
      );
      return { result: columns.rows, sources: types.rows };
    });
    expect(result.map((column) => column.name)).toEqual([...Object.keys(SOURCES), 'eligibility']);
    expect(Object.fromEntries(result.map((column) => [column.name, column.type]))).toEqual({
      ...Object.fromEntries(sources.map((column) => [column.name, column.type])),
      eligibility: 'jsonb',
    });
    for (const { name } of result) {
      for (const word of FORBIDDEN) expect(name, word).not.toContain(word);
    }
  });

  it('is callable by app_api alone, never PUBLIC', async () => {
    expect(await callers()).toEqual({
      app_api: 'ok',
      app_auth: '42501',
      app_worker: '42501',
      app_queue: '42501',
    });
    const granted = await withClient('app_api', async (client) => {
      const { rows } = await client.query<{ grantee: string }>(
        `SELECT CASE WHEN g.grantee = 0 THEN 'PUBLIC' ELSE g.grantee::regrole::text END AS grantee
           FROM pg_catalog.pg_proc p,
                pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) g
          WHERE p.oid = $1::regprocedure AND g.privilege_type = 'EXECUTE'
          ORDER BY 1`,
        [SIGNATURE],
      );
      return rows.map((row) => row.grantee);
    });
    expect(granted).toEqual(['app_api', OWNER]);
  });

  it('is owned by a role that cannot log in, bypass row-level security or create roles', async () => {
    const role = await withClient('app_api', async (client) => {
      const { rows } = await client.query<Row>(
        `SELECT r.rolcanlogin, r.rolsuper, r.rolbypassrls, r.rolcreaterole
           FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_roles r ON r.oid = p.proowner
          WHERE p.oid = $1::regprocedure AND r.rolname = $2`,
        [SIGNATURE, OWNER],
      );
      return rows;
    });
    expect(role).toEqual([
      { rolcanlogin: false, rolsuper: false, rolbypassrls: false, rolcreaterole: false },
    ]);
  });

  it('gives the same answer when the caller puts shadowing objects first on its search_path', () =>
    asMigratorRolledBack(async (client) => {
      await client.query('CREATE SCHEMA shadow');
      await client.query(`CREATE TABLE shadow.tenant (id uuid, slug text, status text)`);
      await client.query("INSERT INTO shadow.tenant VALUES ($1, $2, 'active')", [b.id, a.slug]);
      await client.query(`CREATE FUNCTION shadow.now() RETURNS timestamptz LANGUAGE sql
                            RETURN '2000-01-01T00:00:00Z'::timestamptz`);
      // migrator may act as the owner only to let itself call the function here.
      await client.query(`SET LOCAL ROLE ${OWNER}`);
      await client.query(`GRANT EXECUTE ON FUNCTION ${SIGNATURE} TO migrator`);
      await client.query('RESET ROLE');
      await client.query('SET LOCAL search_path = shadow, pg_catalog, grants, app');
      const { rows } = await client.query<Row>(
        'SELECT round_id FROM grants.public_open_rounds($1)',
        [a.slug],
      );
      expect(rows.map((row) => row['round_id'])).toEqual([roundA]);
    }));
});
