// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The warehouse snapshot through the whole API against the test database,
// as app_api, for two tenants: only a tenant admin downloads it, it holds
// the tenant's released awards and nothing about an unreleased decision, a
// draft, a reviewer or a person's details, another tenant's rows never
// appear, each download is audited, and the script loads with psql into a
// fresh PostgreSQL 16 container where commitments join to organisations and
// dates. Docker must be running.

import { classification } from '@pixel-scientists/db/classification';
import type { ClassificationLookup } from '@pixel-scientists/domain/warehouse';
import { warehouseTableNames } from '@pixel-scientists/domain/warehouse';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { accepted, declined, startDecisionsApi, waitlisted } from '../../../test/decisions-api.ts';
import type { DecisionsApi } from '../../../test/decisions-api.ts';
import { startFreshPostgres, type FreshPostgres } from '../../../test/psql.ts';
import { answer, programmeBody } from '../../../test/programme-api.ts';
import { addMember, events, type Member } from '../../../test/settings-api.ts';
import { smtpTestSettings, tenantId } from '../../../test/support.ts';
import { loadConfig } from '../../config.ts';
import { openDatabase } from '../../database.ts';
import { createLogger } from '../../logger.ts';
import { countField } from './handler.ts';
import { buildSnapshot } from './snapshot.ts';
import { grantsWarehouse } from '@pixel-scientists/grants/server';
import { partyWarehouse } from '@pixel-scientists/party/server';

// Each request runs a few statements in a transaction, which is slow on a busy machine.
vi.setConfig({ testTimeout: 60_000 });

const PATH = '/console/warehouse/snapshot';
const ORGANISATION = 'Northfield Allotment Society';
const COMMENT = 'Reviewer-only-comment-4f2a';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

let t: DecisionsApi;
let adminB: Member;
let postgres: FreshPostgres;
let seeded: Awaited<ReturnType<typeof seed>>;

beforeAll(async () => {
  t = await startDecisionsApi('41070');
  adminB = await addMember(t.tenantB, 'console', 'tenant_admin');
  postgres = await startFreshPostgres();
  seeded = await seed();
}, 180_000);

afterAll(async () => {
  await t.close();
  await postgres.stop();
});

const download = (member: Member | undefined, path = PATH) => t.send(member, 'GET', path);

async function script(member: Member = t.adminA): Promise<string> {
  const response = await download(member);
  expect(response.statusCode, response.body).toBe(200);
  return response.body;
}

/** The rows of one table's COPY block, by column name. */
function table(text: string, name: string): Record<string, string>[] {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`COPY "${name}" (`));
  expect(start, `${name} has no COPY block`).toBeGreaterThanOrEqual(0);
  const columns = [...(lines[start] ?? '').matchAll(/"(\w+)"/g)].slice(1).map((match) => match[1]);
  const end = lines.indexOf('\\.', start);
  return lines.slice(start + 1, end).map((line) => {
    const values = line.split('\t');
    return Object.fromEntries(columns.map((column, index) => [column ?? '', values[index] ?? '']));
  });
}

/** One round whose four submissions are decided, three released and one not, and two reviews. */
async function seed() {
  const round = await t.reviewRound();
  const [a, b, c, d] = [
    await t.submission(round),
    await t.submission(round),
    await t.submission(round),
    await t.submission(round),
  ];
  await t.recorded(a, accepted(15_000));
  await t.recorded(b, waitlisted);
  await t.recorded(c, declined);
  await answer(t.release(round.open.round.id));
  await t.recorded(d, accepted(12_345));
  const draft = await t.aDraft(t.ann, round.open.round.id);

  const scored = await t.assigned(t.grace, t.alan);
  const ids = await t.assignmentsOf(scored.submissionId);
  const scores = (comment: string) => ({
    scores: [
      { criterionId: scored.round.need.id, score: 4, comment },
      { criterionId: scored.round.impact.id, score: 2, comment },
    ],
  });
  await answer(
    t.send(
      t.grace,
      'POST',
      `/console/reviews/${ids.get(t.grace.membershipId) ?? ''}/submit`,
      scores(COMMENT),
    ),
  );
  await answer(
    t.send(
      t.alan,
      'PUT',
      `/console/reviews/${ids.get(t.alan.membershipId) ?? ''}/scores`,
      scores('Unsubmitted'),
    ),
  );
  await answer(
    t.send(t.managerB, 'POST', '/console/programmes', programmeBody({ title: 'Tenant B only' })),
    201,
  );
  const [decision] = await t.decisions<{ id: string }>('d.application_id = $1', [a]);
  const others = await t.decisions<{ id: string }>('d.application_id = ANY($1)', [[b, c, d]]);
  return {
    round,
    a,
    draft,
    decisionId: decision?.id ?? '',
    otherDecisionIds: others.map((row) => row.id),
    gradedAssignment: ids.get(t.grace.membershipId) ?? '',
  };
}

describe('the download', () => {
  it('is a SQL attachment with a header, one transaction, and every table of the model', async () => {
    const response = await download(t.adminA);

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^application\/sql/);
    expect(response.headers['content-disposition']).toMatch(
      /^attachment; filename="warehouse-snapshot-\d{4}-\d{2}-\d{2}\.sql"$/,
    );
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    const lines = response.body.split('\n');
    expect(lines.slice(0, 2)).toEqual(['-- Warehouse snapshot', `-- Tenant: ${t.tenantA.id}`]);
    expect(lines).toContain('BEGIN;');
    expect(lines.at(-2)).toBe('COMMIT;');
    expect([...response.body.matchAll(/^CREATE TABLE "(\w+)"/gm)].map((match) => match[1])).toEqual(
      warehouseTableNames,
    );
  });

  it('holds the released award as a commitment and no unreleased decision', async () => {
    const text = await script();

    const commitments = table(text, 'commitment');

    expect(commitments).toHaveLength(1);
    expect(commitments[0]).toMatchObject({
      id: seeded.decisionId,
      source_module: 'grants',
      programme_id: seeded.round.open.programmeId,
      amount_minor: '1500000',
      currency: 'GBP',
    });
    for (const id of seeded.otherDecisionIds) expect(text).not.toContain(id);
    expect(text).not.toContain('1234500');

    const outcomes = new Map(
      table(text, 'grants_application').map((row) => [row['id'], row['outcome']] as const),
    );
    expect(outcomes.get(seeded.a)).toBe('accepted');
    expect([...outcomes.values()].sort()).toEqual([
      '\\N',
      '\\N',
      'accepted',
      'declined',
      'waitlisted',
    ]);
  });

  it('holds submitted applications and reviews only, and no answer, comment, reviewer or person detail', async () => {
    const text = await script();

    expect(text).not.toContain(seeded.draft.id);
    expect(table(text, 'grants_application')).toHaveLength(5);
    expect(table(text, 'grants_score').map((row) => row['assignment_id'])).toEqual([
      seeded.gradedAssignment,
      seeded.gradedAssignment,
    ]);
    for (const hidden of [
      COMMENT,
      'Unsubmitted',
      t.grace.membershipId,
      t.alan.membershipId,
      'Grace',
      'Hopper',
      'Lovelace',
      '@example.org',
      'Ada Applicant-Secret',
      'Staff-only note',
      'A new roof for the village hall',
    ]) {
      expect(text).not.toContain(hidden);
    }
    expect(table(text, 'person').every((row) => Object.keys(row).length === 3)).toBe(true);
    expect(text).toContain(ORGANISATION);
  });

  it('records the rows in each table in the audit log', async () => {
    const before = (await events(t.tenantA, 'platform.warehouse.exported')).length;
    const text = await script();

    const recorded = await events(t.tenantA, 'platform.warehouse.exported');

    expect(recorded).toHaveLength(before + 1);
    const event = recorded.at(-1);
    expect(event?.actor_id).toBe(t.adminA.membershipId);
    expect(event?.entity_id).toBe(t.tenantA.id);
    expect(event?.changes).toEqual(
      Object.fromEntries(
        warehouseTableNames.map((name) => [
          countField(name),
          { before: null, after: table(text, name).length },
        ]),
      ),
    );
  });

  it('loads with psql into a fresh PostgreSQL where commitments join to organisations and dates', async () => {
    const loaded = await postgres.load(await script());

    expect(loaded.stderr).toBe('');
    expect(loaded.code).toBe(0);
    const joined = await postgres.json<Record<string, unknown>[]>(
      loaded.database,
      `SELECT coalesce(json_agg(j), '[]') FROM (
         SELECT o.name AS organisation, o.org_id, p.title AS programme, c.amount_minor,
                c.currency, c.source_module, d.year, d.fiscal_year
           FROM commitment c
           JOIN organisation o ON o.id = c.organisation_id
           JOIN programme p ON p.id = c.programme_id
           JOIN date d ON d.date = c.committed_on) j`,
    );
    expect(joined).toEqual([
      {
        organisation: ORGANISATION,
        org_id: 'GB-CHC-1234567',
        programme: 'Community Spaces Fund',
        amount_minor: 1_500_000,
        currency: 'GBP',
        source_module: 'grants',
        year: expect.any(Number) as number,
        fiscal_year: expect.any(Number) as number,
      },
    ]);
    const organisations = await t.rows<{ count: string }>(
      'SELECT count(*) FROM party.organisation',
    );
    expect(await postgres.json<number>(loaded.database, 'SELECT count(*) FROM organisation')).toBe(
      Number(organisations[0]?.count),
    );
  });

  it('stores nothing from another tenant, whose own snapshot holds only its own rows', async () => {
    const own = await script();
    const other = await script(adminB);

    expect(other.split('\n')[1]).toBe(`-- Tenant: ${t.tenantB.id}`);
    expect(other).toContain('Tenant B only');
    expect(own).not.toContain('Tenant B only');
    expect(table(other, 'commitment')).toEqual([]);
    expect(table(other, 'organisation')).toEqual([]);
    const ids = (text: string) => new Set(text.match(UUID));
    const shared = [...ids(own)].filter((id) => ids(other).has(id));
    expect(shared).toEqual([]);
    expect(await events(t.tenantB, 'platform.warehouse.exported')).toHaveLength(1);
  });
});

describe('who may download', () => {
  it('refuses everyone but a tenant admin, and records nothing', async () => {
    const before = (await events(t.tenantA, 'platform.warehouse.exported')).length;
    const refused = [
      [t.managerA, 403],
      [t.reviewerA, 403],
      [t.applicantA, 403],
      [undefined, 401],
    ] as const;

    for (const [member, status] of refused) {
      const response = await download(member);
      expect(response.statusCode, String(member?.app)).toBe(status);
      expect(response.body).not.toContain('CREATE TABLE');
    }

    expect(await events(t.tenantA, 'platform.warehouse.exported')).toHaveLength(before);
  });

  it('refuses a tenant named in the request, so the session alone decides', async () => {
    const before = (await events(t.tenantB, 'platform.warehouse.exported')).length;

    const response = await download(t.adminA, `${PATH}?tenantId=${t.tenantB.id}`);

    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain('CREATE TABLE');
    expect(await events(t.tenantB, 'platform.warehouse.exported')).toHaveLength(before);
  });
});

describe('the classification map', () => {
  /** The snapshot built in tenant A's transaction under `map`, as the route does. */
  async function built(map: ClassificationLookup): Promise<string> {
    const { database: settings } = loadConfig({
      ...process.env,
      ...smtpTestSettings,
      TPS_API_PORT: '41070',
      TPS_DB_NAME: process.env['TPS_TEST_DB_NAME'],
    });
    const database = openDatabase(settings, createLogger({ level: 'silent' }));
    try {
      return await database.inTenant(tenantId(t.tenantA.id), async (tx) => {
        const { script: text } = await buildSnapshot(tx, {
          tenantId: t.tenantA.id,
          tenant: { timezone: 'Europe/London', fiscalYearStartMonth: 4 },
          contributions: [partyWarehouse, grantsWarehouse],
          classification: map,
          at: new Date(),
          maxBytes: 5 * 1024 * 1024,
        });
        return text;
      });
    } finally {
      await database.close();
    }
  }

  const reclassify = (source: string, sensitivity: string): ClassificationLookup => {
    const dot = source.lastIndexOf('.');
    const name = source.slice(dot + 1);
    const tableName = source.slice(0, dot);
    return {
      ...classification,
      [tableName]: { ...classification[tableName], [name]: { sensitivity } },
    };
  };

  it('is what lets a column out: classify it personal and it leaves the file', async () => {
    const whole = await built(classification);
    expect(whole).toContain(ORGANISATION);
    expect(table(whole, 'commitment')[0]).toHaveProperty('amount_minor', '1500000');

    const withoutName = await built(reclassify('party.organisation.name', 'personal'));
    expect(withoutName).not.toContain(ORGANISATION);
    expect(withoutName).not.toContain('"name"');
    expect(table(withoutName, 'organisation')[0]).not.toHaveProperty('name');

    const withoutAmount = await built(
      reclassify('grants.decision.amount_minor', 'special_category'),
    );
    expect(withoutAmount).not.toContain('amount_minor');
    expect(withoutAmount).not.toContain('1500000');
    expect(table(withoutAmount, 'commitment')[0]).toHaveProperty('currency', 'GBP');
  });
});
