// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The volume scenario against the test database, loaded once under a slug no
// earlier run has used: how long it takes, that each row sits in its own
// tenant, and how long the queries behind the busiest pages take at this
// size. Each query copies the one its server code builds:
//
//   submission list and filter  modules/grants/src/server/submissions/read.ts
//   submission detail           the same, and assessment/assignments.ts
//   reviewer assignment list    modules/grants/src/server/assessment/reviews.ts
//   organisation search         modules/party/src/server/search/index.ts
//   portal "my applications"    modules/grants/src/server/applications/read.ts
//
// packages/db cannot import those modules, so a change there needs one here.
// Each must take the database under 100 ms, planning included, the median of
// five runs after one to warm up, leaving room inside V1's 500 ms page
// target. A slower one fails with its EXPLAIN (ANALYZE, BUFFERS) plan, to
// take to the lead: indexes are migrations, not seed work.

import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import { withClient } from '../test/connect.ts';
import { asRoleIn } from '../test/tenants.ts';
import { base } from './base.ts';
import { writeVolume } from './bulk.ts';
import { writeScenario, type SeededTenant } from './scenario.ts';
import { volumeTenant } from './volume.ts';

const PASSWORD = 'a long synthetic passphrase';
const LIMIT_MS = 100;

const suffix = randomBytes(4).toString('hex');
let volume: SeededTenant;
let other: SeededTenant;
let loadMs: number;

beforeAll(async () => {
  const started = performance.now();
  volume = await withClient('migrator', (client) =>
    writeVolume(client, PASSWORD, { ...volumeTenant, slug: `westmere-${suffix}` }),
  );
  loadMs = performance.now() - started;
  const others = base
    .slice(0, 1)
    .map((tenant) => ({ ...tenant, slug: `${tenant.slug}-${suffix}` }));
  [other] = (await withClient('migrator', (client) => writeScenario(client, others, PASSWORD))) as [
    SeededTenant,
  ];
}, 600_000);

const sizeOf = (table: string) => volume.rows[table]?.length ?? 0;

describe('the volume scenario, written', { timeout: 120_000 }, () => {
  it('loads at design-partner size in under ten minutes', () => {
    expect(loadMs).toBeLessThan(600_000);
    expect(sizeOf('grants.programme')).toBe(3);
    expect(sizeOf('grants.round')).toBe(6);
    expect(sizeOf('party.organisation')).toBe(2_500);
    expect(sizeOf('party.person')).toBe(3_043);
    expect(sizeOf('grants.application')).toBe(4_000);
    expect(sizeOf('grants.assignment')).toBeGreaterThan(11_000);
    expect(sizeOf('grants.decision')).toBeGreaterThan(1_300);
  });

  it('puts every row in its own tenant, where another tenant cannot see it', async () => {
    const tables = Object.keys(volume.rows).filter((table) => !table.startsWith('auth.'));
    for (const [tenant, others] of [
      [volume, other],
      [other, volume],
    ] as const) {
      const seen = await asRoleIn('app_api', tenant.id, async (client) => {
        const found: Record<string, { own: number; foreign: number }> = {};
        for (const table of tables) {
          const own = tenant.rows[table] ?? [];
          const foreign = others.rows[table] ?? [];
          const { rows } = await client.query<{ own: string; foreign: string }>(
            `SELECT count(*) FILTER (WHERE id = ANY($1::uuid[])) AS own,
                    count(*) FILTER (WHERE id = ANY($2::uuid[])) AS foreign
               FROM ${table}`,
            [own, foreign],
          );
          found[table] = { own: Number(rows[0]?.own), foreign: Number(rows[0]?.foreign) };
        }
        return found;
      });
      const own = (table: string) => ({ own: tenant.rows[table]?.length ?? 0, foreign: 0 });
      expect(seen).toEqual(Object.fromEntries(tables.map((table) => [table, own(table)])));
    }
  });

  it('has every application status, released and private decisions, and claimed identifiers', async () => {
    const found = await asRoleIn('app_api', volume.id, async (client) => {
      const one = async (text: string) => (await client.query<Record<string, unknown>>(text)).rows;
      return {
        statuses: await one(
          'SELECT status, count(*)::int AS n FROM grants.application GROUP BY status ORDER BY status',
        ),
        released: await one(
          'SELECT released_at IS NOT NULL AS released, count(*)::int AS n FROM grants.decision GROUP BY 1 ORDER BY 1',
        ),
        claims: await one(
          `SELECT count(*)::int AS n FROM (
             SELECT scheme, identifier FROM party.organisation_identifier
              WHERE verified_at IS NULL GROUP BY 1, 2 HAVING count(*) > 1) AS shared`,
        ),
        linked: await one(
          `SELECT count(*)::int AS n FROM party.party WHERE merged_into IS NOT NULL`,
        ),
      };
    });
    expect(found.statuses.map(({ status }) => status)).toEqual(['draft', 'submitted', 'withdrawn']);
    expect(found.released.map(({ released }) => released)).toEqual([false, true]);
    expect(found.claims[0]?.n).toBeGreaterThanOrEqual(30);
    expect(found.linked[0]?.n).toBe(0);
  });
});

type Statement = readonly [text: string, values: readonly unknown[]];

/**
 * The database's own time for `statements`, in order, planning included: the
 * median of five runs after one to warm up. EXPLAIN ANALYZE measures it, so
 * a busy test machine's scheduling and the client's own work do not count,
 * and its instrumentation makes the figure a little high, never low.
 */
async function timed(client: pg.ClientBase, statements: readonly Statement[]): Promise<number> {
  const runs: number[] = [];
  for (let run = 0; run < 6; run += 1) {
    let ms = 0;
    for (const [text, values] of statements) {
      const { rows } = await client.query<{ 'QUERY PLAN': [Record<string, number>] }>(
        `EXPLAIN (ANALYZE, FORMAT JSON) ${text}`,
        [...values],
      );
      const [plan] = rows[0]?.['QUERY PLAN'] ?? [{}];
      ms += (plan['Planning Time'] ?? Infinity) + (plan['Execution Time'] ?? Infinity);
    }
    if (run > 0) runs.push(ms);
  }
  return runs.sort((a, b) => a - b)[2] ?? Infinity;
}

async function plans(client: pg.ClientBase, statements: readonly Statement[]): Promise<string> {
  const lines: string[] = [];
  for (const [text, values] of statements) {
    const { rows } = await client.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN (ANALYZE, BUFFERS) ${text}`,
      [...values],
    );
    lines.push(text, ...rows.map((row) => row['QUERY PLAN']), '');
  }
  return lines.join('\n');
}

const LIST = `
  SELECT a.id, a.status, a.submitted_at, a.submitted_late, a.organisation_id, a.submission_route,
         r.id AS round_id, r.title AS round_title, p.id AS programme_id, p.title AS programme_title,
         s.id AS stage_id, s.name AS stage_name,
         (SELECT e.outcome FROM grants.eligibility_result e WHERE e.application_id = a.id
           ORDER BY e.checked_at DESC, e.id DESC LIMIT 1) AS eligibility
    FROM grants.application a
    JOIN grants.round r ON r.id = a.round_id
    JOIN grants.programme p ON p.id = r.programme_id
    JOIN grants.stage s ON s.id = a.stage_id
   WHERE a.status IN ('submitted', 'withdrawn')`;
const COUNT = `
  SELECT count(*) AS total
    FROM grants.application a
    JOIN grants.round r ON r.id = a.round_id
    JOIN grants.programme p ON p.id = r.programme_id
    JOIN grants.stage s ON s.id = a.stage_id
   WHERE a.status IN ('submitted', 'withdrawn')`;
const FILTER = `
     AND r.id = $1 AND s.id = $2 AND a.status = 'submitted' AND a.submitted_late = false
     AND (SELECT e.outcome FROM grants.eligibility_result e WHERE e.application_id = a.id
           ORDER BY e.checked_at DESC, e.id DESC LIMIT 1) = 'eligible'`;
const PAGE = ' ORDER BY a.submitted_at DESC, a.id DESC LIMIT 51';
const NAMES = 'SELECT id, name FROM party.organisation WHERE id = ANY($1::uuid[])';

describe('the busiest pages at volume', { timeout: 120_000 }, () => {
  let pages: Record<string, readonly Statement[]>;

  beforeAll(async () => {
    pages = await asRoleIn('app_api', volume.id, async (client) => {
      const first = async (text: string) =>
        (await client.query<Record<string, string>>(text)).rows[0] ?? {};
      const busy = await first(
        `SELECT a.round_id, a.stage_id FROM grants.application a WHERE a.status = 'submitted'
          GROUP BY 1, 2 ORDER BY count(*) DESC LIMIT 1`,
      );
      const decided = await first(
        `SELECT a.id, a.organisation_id, a.applicant_person_id FROM grants.application a
           JOIN grants.decision d ON d.application_id = a.id ORDER BY a.id LIMIT 1`,
      );
      const reviewer = await first(
        `SELECT reviewer_membership_id AS id FROM grants.assignment
          GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`,
      );
      const applicant = await first(
        `SELECT p.user_id AS id FROM grants.application a JOIN party.person p ON p.id = a.applicant_person_id
          GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`,
      );
      const listed = await client.query<{ organisation_id: string }>(LIST + PAGE);
      const organisations = listed.rows.map((row) => row.organisation_id);
      const terms = ['allotment', 'Ambleford Food Bank', '1900037'];
      return {
        'submission list': [
          [LIST + PAGE, []],
          [COUNT, []],
          [NAMES, [organisations]],
        ],
        'submission list, filtered': [
          [LIST + FILTER + PAGE, [busy['round_id'], busy['stage_id']]],
          [COUNT + FILTER, [busy['round_id'], busy['stage_id']]],
          [NAMES, [organisations]],
        ],
        'submission detail': [
          [
            `SELECT a.*, f.definition FROM grants.application a
               JOIN grants.form_version f ON f.id = a.form_version_id
              WHERE a.id = $1 AND a.status <> 'draft'`,
            [decided['id']],
          ],
          [
            `SELECT t.moved_at, t.moved_by, s.name FROM grants.stage_transition t
               JOIN grants.stage s ON s.id = t.to_stage_id
              WHERE t.application_id = $1 ORDER BY t.moved_at, t.id`,
            [decided['id']],
          ],
          [
            `SELECT a.id, a.status, a.reviewer_membership_id, s.name,
                    (SELECT count(*) FROM grants.score c WHERE c.assignment_id = a.id) AS scored
               FROM grants.assignment a JOIN grants.stage s ON s.id = a.stage_id
              WHERE a.application_id = $1 ORDER BY a.created_at, a.id`,
            [decided['id']],
          ],
          ['SELECT * FROM grants.decision WHERE application_id = $1', [decided['id']]],
          [NAMES, [[decided['organisation_id']]]],
          [
            'SELECT given_name, family_name, email, phone FROM party.person WHERE id = $1',
            [decided['applicant_person_id']],
          ],
        ],
        'reviewer assignment list': [
          [
            `SELECT a.id, a.status, a.created_at, ap.id AS application_id, r.title AS round_title,
                    p.title AS programme_title, s.name AS stage_name,
                    (SELECT count(*) FROM grants.score c WHERE c.assignment_id = a.id) AS scored
               FROM grants.assignment a
               JOIN grants.application ap ON ap.id = a.application_id
               JOIN grants.round r ON r.id = a.round_id
               JOIN grants.programme p ON p.id = r.programme_id
               JOIN grants.stage s ON s.id = a.stage_id
              WHERE a.reviewer_membership_id = $1 AND a.status <> 'conflicted'
                AND ap.status = 'submitted'
              ORDER BY a.created_at, a.id`,
            [reviewer['id']],
          ],
        ],
        // One search a request, by part of a name, by a whole name and by an identifier.
        ...Object.fromEntries(
          terms.map((term, index) => [
            `organisation search ${String(index + 1)}`,
            [
              [
                `SELECT o.id, o.name FROM party.organisation o JOIN party.party p ON p.id = o.id
                  WHERE p.status NOT IN ('merged', 'erased')
                    AND (strpos(lower(o.name), lower($1)) > 0
                         OR ext.similarity(o.name, $1) >= 0.3
                         OR EXISTS (SELECT i.id FROM party.organisation_identifier i
                                     WHERE i.organisation_id = o.id AND i.identifier = ANY($2::text[])))
                  ORDER BY ext.similarity(o.name, $1) DESC, o.name, o.id LIMIT 20`,
                [term, [term.toUpperCase().replace(/\s+/g, '')]],
              ],
            ] satisfies Statement[],
          ]),
        ),
        'portal my applications': [
          ['SELECT id FROM party.person WHERE user_id = $1', [applicant['id']]],
          [
            `SELECT a.id, a.status, a.stage_id, a.updated_at, a.submitted_at, a.round_id,
                    r.title AS round_title, r.closes_at, r.timezone, p.title AS programme_title,
                    a.organisation_id, a.submission_route
               FROM grants.application a
               JOIN grants.round r ON r.id = a.round_id
               JOIN grants.programme p ON p.id = r.programme_id
               JOIN party.person pe ON pe.id = a.applicant_person_id
              WHERE pe.user_id = $1 AND (a.submission_route = 'portal' OR a.status <> 'draft')
              ORDER BY a.updated_at DESC, a.id`,
            [applicant['id']],
          ],
          [
            `SELECT d.application_id, d.outcome, d.amount_minor FROM grants.decision d
               JOIN grants.application a ON a.id = d.application_id
               JOIN party.person pe ON pe.id = a.applicant_person_id
              WHERE pe.user_id = $1 AND d.released_at IS NOT NULL`,
            [applicant['id']],
          ],
        ],
      };
    });
  });

  for (const page of [
    'submission list',
    'submission list, filtered',
    'submission detail',
    'reviewer assignment list',
    'organisation search 1',
    'organisation search 2',
    'organisation search 3',
    'portal my applications',
  ]) {
    it(`answers the ${page} in under ${String(LIMIT_MS)} ms`, async () => {
      await asRoleIn('app_api', volume.id, async (client) => {
        const statements = pages[page] ?? [];
        expect(statements.length).toBeGreaterThan(0);
        const ms = await timed(client, statements);
        if (ms >= LIMIT_MS) {
          expect.fail(`${page} took ${ms.toFixed(1)} ms:\n${await plans(client, statements)}`);
        }
      });
    });
  }
});
