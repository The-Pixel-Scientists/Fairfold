// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The insight handlers against the test database, as app_api, each call in its
// own tenant transaction, for two tenants. Audit events are checked against
// the real classification and configuration versions against the real diff
// schemas. Grants' counts are a stand-in that records what it was asked, with
// invented option values a leak would be easy to find by.

import { randomUUID } from 'node:crypto';

import { configDiffSchemas } from '@pixel-scientists/domain/platform/settings';
import { isAuditAction, roles } from '@pixel-scientists/domain/platform';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../../../../packages/db/src/database.ts';
import { keptChanges } from '../../../../packages/db/src/audit.ts';
import { trustedTenantId, withTenant } from '../../../../packages/db/src/tenant-context.ts';
import { databaseSettings } from '../../../../packages/db/test/connect.ts';
import {
  addMember,
  asMigratorIn,
  createTestTenant,
  type TestTenant,
} from '../../../../packages/db/test/tenants.ts';
import {
  disclosureFloor,
  insightAuditActions,
  insightRoutes,
  monitoringReportSchema,
  type ReportDefinitionInput,
} from '../contracts/index.ts';
import type { InsightContext, MonitoringCounts, Tx, WarehouseRead } from './context.ts';
import { insightHandlers } from './index.ts';
import { serverRefusals } from './messages.ts';
import { insightRefusals } from '../contracts/index.ts';

class Refused extends Error {
  readonly status: number;
  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
  }
}

/** What the stand-in for grants answers, and what it was asked. */
let answer: MonitoringCounts;
const asked: unknown[][] = [];

/** What the stand-in for the warehouse answers, and the tables it was asked for. */
let warehouse: WarehouseRead = { status: 'unavailable' };
const tablesAsked: string[] = [];

const handlers = insightHandlers({
  notFound: () => new Refused(404, 'Not found'),
  refuse: (status, detail) => new Refused(status, detail),
  monitoringCounts: (_tx, roundIds) => {
    asked.push([...roundIds]);
    return Promise.resolve(answer);
  },
  warehouseRows: (_tx, table) => {
    tablesAsked.push(table);
    return Promise.resolve(warehouse);
  },
});

interface Staff {
  readonly tenant: TestTenant;
  readonly member: string;
}

let db: ReturnType<typeof createDatabase<unknown>>;
let a: Staff;
let b: Staff;

const staff = async (): Promise<Staff> => {
  const tenant = await createTestTenant();
  return { tenant, member: await asMigratorIn(tenant.id, (client) => addMember(client, tenant)) };
};

interface Recorded {
  readonly audit: { action: string; entityId: string; changes?: object }[];
  readonly config: { entityType: string; entityId: string; diff: unknown }[];
}

/** A request's context that keeps what a handler wrote, after checking it as the platform would. */
function request(who: Staff) {
  const wrote: Recorded = { audit: [], config: [] };
  const after: (() => Promise<void>)[] = [];
  const context: InsightContext = {
    audit: {
      record: (event) => {
        expect(isAuditAction(event.action)).toBe(true);
        expect(insightAuditActions).toContain(event.action);
        keptChanges(event.changes ?? {});
        wrote.audit.push(event);
        return Promise.resolve();
      },
    },
    config: {
      record: (
        entityType: 'insight.report_definition' | 'insight.disclosure_rule',
        entityId,
        diff,
      ) => {
        expect(() => configDiffSchemas[entityType].parse(diff)).not.toThrow();
        wrote.config.push({ entityType, entityId, diff });
        return Promise.resolve();
      },
    },
    membership: { id: who.member },
    requestId: randomUUID(),
    afterCommit: (work) => {
      after.push(work);
    },
  };
  return { context, wrote, after };
}

const inTenant = <T>(who: Staff, work: (tx: Tx) => Promise<T>): Promise<T> =>
  withTenant(db, trustedTenantId(who.tenant.id), work);

const asMigrator = <T>(who: Staff, sql: string, values: unknown[] = []) =>
  asMigratorIn(who.tenant.id, async (client) => (await client.query<T & object>(sql, values)).rows);

/** Calls a handler as `who`, in a transaction of its own, with the context it was given. */
function call(who: Staff, name: keyof typeof handlers, input: object = {}) {
  const { context, wrote, after } = request(who);
  const run = () =>
    inTenant(who, (tx) =>
      (handlers[name] as (args: object) => Promise<unknown>)({ tx, context, input }),
    );
  return { run, wrote, after, result: run };
}

const round = randomUUID();
const monitoringBody = (change: object = {}): ReportDefinitionInput => ({
  kind: 'monitoring',
  name: `Ethnic group ${randomUUID()}`,
  description: null,
  source: 'f_group',
  groupBy: {},
  filters: { [randomUUID()]: { field: 'round', operator: 'eq', value: round } },
  ...change,
});

const warehouseBody = (): ReportDefinitionInput =>
  ({
    kind: 'warehouse',
    name: `Awards ${randomUUID()}`,
    description: 'Awards by programme.',
    source: 'grants_application',
    measures: { [randomUUID()]: 'count' },
    groupBy: {},
    filters: {},
  }) as unknown as ReportDefinitionInput;

async function made(who: Staff, body: ReportDefinitionInput = monitoringBody()) {
  const { run, wrote } = call(who, 'createReportDefinition', { body });
  const report = (await run()) as { id: string; version: number };
  return { report, wrote, body };
}

beforeAll(async () => {
  const { host, port, database, password } = databaseSettings('app_api', 4);
  db = createDatabase({
    host,
    port,
    database,
    password,
    role: 'app_api',
    maxConnections: 4,
    applicationName: 'tps-db-tests',
  });
  [a, b] = await Promise.all([staff(), staff()]);
}, 60_000);

afterAll(async () => {
  await db.destroy();
});

describe('the routes', () => {
  it('are for the console, and none is held by a reviewer or an applicant', () => {
    for (const route of Object.values(insightRoutes)) {
      expect(route.audience).toBe('console');
      for (const role of ['reviewer', 'applicant'] as const) {
        expect(roles[role].permissions as readonly string[]).not.toContain(route.permission);
      }
    }
  });

  it('give the monitoring permission to the analyst alone, and the rule to the tenant admin alone', () => {
    const holders = (permission: string) =>
      Object.entries(roles)
        .filter(([, role]) => (role.permissions as readonly string[]).includes(permission))
        .map(([name]) => name);

    expect(holders('insight.monitoring.report')).toEqual(['analyst']);
    expect(holders('insight.disclosure_rules.manage')).toEqual(['tenant_admin']);
  });
});

describe('report definitions', () => {
  it('are made with a first version, a configuration version and an audit event', async () => {
    const { report, wrote, body } = await made(a);

    expect(report).toMatchObject({ version: 1, name: body.name, kind: 'monitoring' });
    expect(wrote.config).toMatchObject([
      { entityType: 'insight.report_definition', entityId: report.id },
    ]);
    expect(wrote.audit).toMatchObject([
      {
        action: 'insight.report_definition.created',
        entityId: report.id,
        changes: { 'insight.report_definition.name': { after: body.name } },
      },
    ]);
    const { reports } = (await call(a, 'listReportDefinitions').run()) as {
      reports: { id: string }[];
    };
    expect(reports.map(({ id }) => id)).toContain(report.id);
  });

  it('keep their first name for another, and refuse a second report of the same name', async () => {
    const first = await made(a);
    await expect(
      call(a, 'createReportDefinition', { body: monitoringBody({ name: first.body.name }) }).run(),
    ).rejects.toThrow(serverRefusals.nameTaken);
  });

  it('are changed with the next version, and a save that changes nothing writes nothing', async () => {
    const { report, body } = await made(a);
    const params = { reportId: report.id };

    const same = call(a, 'updateReportDefinition', { params, body });
    expect(await same.run()).toMatchObject({ version: 1 });
    expect(same.wrote).toEqual({ audit: [], config: [] });

    const renamed = call(a, 'updateReportDefinition', {
      params,
      body: { ...body, name: `${body.name} renamed` },
    });
    expect(await renamed.run()).toMatchObject({ version: 2 });
    expect(renamed.wrote.config).toMatchObject([
      { diff: [{ path: 'name', to: `${body.name} renamed` }] },
    ]);
    expect(renamed.wrote.audit).toMatchObject([
      { action: 'insight.report_definition.changed', entityId: report.id },
    ]);
  });

  it('record a filter that moved to another round, without its value', async () => {
    const { report, body } = await made(a);
    const [id] = Object.keys(body.filters);
    const moved = {
      ...body,
      filters: { [id ?? '']: { field: 'round', operator: 'eq', value: randomUUID() } },
    };

    const change = call(a, 'updateReportDefinition', {
      params: { reportId: report.id },
      body: moved,
    });
    expect(await change.run()).toMatchObject({ version: 2 });
    expect(JSON.stringify(change.wrote)).not.toContain(round);
    expect(change.wrote.config).toHaveLength(1);
  });

  it('are archived once, and then change no more', async () => {
    const { report, body } = await made(a);
    const params = { reportId: report.id };
    const first = call(a, 'archiveReportDefinition', { params });

    expect(await first.run()).not.toMatchObject({ archivedAt: null });
    expect(first.wrote.audit).toMatchObject([{ action: 'insight.report_definition.archived' }]);
    const again = call(a, 'archiveReportDefinition', { params });
    await again.run();
    expect(again.wrote.audit).toEqual([]);
    await expect(call(a, 'updateReportDefinition', { params, body }).run()).rejects.toThrow(
      insightRefusals.archived,
    );
  });

  it('keep their kind', async () => {
    const { report } = await made(a);

    await expect(
      call(a, 'updateReportDefinition', {
        params: { reportId: report.id },
        body: warehouseBody(),
      }).run(),
    ).rejects.toThrow(insightRefusals.kindFixed);
  });

  it('read as missing to another tenant, which changes nothing of the first tenant’s', async () => {
    const { report, body } = await made(a);
    const params = { reportId: report.id };
    const unknown = { reportId: randomUUID() };

    for (const [name, input] of [
      ['getReportDefinition', { params }],
      ['updateReportDefinition', { params, body }],
      ['archiveReportDefinition', { params }],
      ['runMonitoringReport', { params }],
    ] as const) {
      const outside = call(b, name, input);
      await expect(outside.run(), name).rejects.toMatchObject({ status: 404 });
      await expect(call(b, name, { ...input, params: unknown }).run(), name).rejects.toMatchObject({
        status: 404,
      });
      expect(outside.wrote).toEqual({ audit: [], config: [] });
    }
    const { reports } = (await call(b, 'listReportDefinitions').run()) as {
      reports: { id: string }[];
    };
    expect(reports.map(({ id }) => id)).not.toContain(report.id);
    expect(await call(a, 'getReportDefinition', { params }).run()).toMatchObject({ version: 1 });
  });
});

describe('the disclosure rule', () => {
  it('is the platform floor until the tenant sets one', async () => {
    const rule = await call(a, 'getDisclosureRule').run();

    expect(rule).toEqual({ version: null, ...disclosureFloor, updatedAt: null });
  });

  it('is set, then raised, with a version, a configuration version and an audit event each time', async () => {
    const tenant = await staff();
    const first = call(tenant, 'updateDisclosureRule', {
      body: { threshold: 15, minimumGroup: 30 },
    });

    expect(await first.run()).toMatchObject({ version: 1, threshold: 15, minimumGroup: 30 });
    expect(first.wrote.config).toMatchObject([
      {
        entityType: 'insight.disclosure_rule',
        diff: [
          { field: 'threshold', from: 10, to: 15 },
          { field: 'minimumGroup', from: 20, to: 30 },
        ],
      },
    ]);
    expect(first.wrote.audit).toMatchObject([
      {
        action: 'insight.disclosure_rule.changed',
        changes: { 'insight.disclosure_rule.threshold': { before: 10, after: 15 } },
      },
    ]);

    const raised = call(tenant, 'updateDisclosureRule', {
      body: { threshold: 20, minimumGroup: 30 },
    });
    expect(await raised.run()).toMatchObject({ version: 2, threshold: 20 });
    expect(raised.wrote.config).toMatchObject([
      { diff: [{ field: 'threshold', from: 15, to: 20 }] },
    ]);

    const same = call(tenant, 'updateDisclosureRule', {
      body: { threshold: 20, minimumGroup: 30 },
    });
    expect(await same.run()).toMatchObject({ version: 2 });
    expect(same.wrote).toEqual({ audit: [], config: [] });
  });

  it('is held at the floor by the database too, and is another tenant’s own', async () => {
    const tenant = await staff();
    await call(tenant, 'updateDisclosureRule', { body: { threshold: 12, minimumGroup: 25 } }).run();

    await expect(
      asMigrator(tenant, 'UPDATE insight.disclosure_rule SET threshold = 9, version = version + 1'),
    ).rejects.toThrow(/disclosure_rule_threshold_floor/);
    await expect(
      asMigrator(
        tenant,
        'UPDATE insight.disclosure_rule SET minimum_group = 19, version = version + 1',
      ),
    ).rejects.toThrow(/disclosure_rule_minimum_group_floor/);
    expect(await call(a, 'getDisclosureRule').run()).toMatchObject({ threshold: 10 });
  });
});

describe('a monitoring run', () => {
  const group = (...options: [string, number][]): MonitoringCounts => ({
    status: 'counted',
    rounds: [
      {
        roundId: round,
        responses: options.reduce((total, [, count]) => total + count, 0),
        questions: [
          { fieldId: 'f_group', options: options.map(([value, count]) => ({ value, count })) },
        ],
      },
    ],
  });

  const insightRows = (who: Staff) =>
    asMigrator<{ n: number }>(
      who,
      `SELECT (SELECT count(*) FROM insight.report_definition)::int
            + (SELECT count(*) FROM insight.publication_run)::int
            + (SELECT count(*) FROM app.file)::int AS n`,
    );

  it('answers only the suppressed table, counting by the round alone, and audits it without a count', async () => {
    const { report } = await made(a);
    answer = group(['marker_one', 40], ['marker_two', 3], ['marker_three', 17]);
    asked.length = 0;
    const before = await insightRows(a);

    const run = call(a, 'runMonitoringReport', { params: { reportId: report.id } });
    const response = (await run.run()) as ReturnType<typeof monitoringReportSchema.parse>;

    expect(monitoringReportSchema.safeParse(response).success).toBe(true);
    expect(asked).toEqual([[round]]);
    expect(response).toMatchObject({
      reportId: report.id,
      reportVersion: 1,
      disclosureRule: { version: null, ...disclosureFloor },
      result: { status: 'shown' },
    });
    const text = JSON.stringify(response);
    expect(text).not.toMatch(/"count":(3|17)\b/);
    expect(text).toContain('"count":40');
    expect(run.wrote.config).toEqual([]);
    expect(run.wrote.audit).toEqual([
      {
        action: 'insight.monitoring_report.run',
        entityId: report.id,
        changes: {
          'insight.report_definition.version': { after: 1 },
          'insight.disclosure_rule.version': { after: null },
        },
      },
    ]);
    expect(JSON.stringify(run.wrote)).not.toMatch(/marker_|f_group/);
    expect(await insightRows(a)).toEqual(before);
  });

  it('withholds a table over too few responses, and still audits the run', async () => {
    const { report } = await made(a);
    answer = group(['marker_one', 8], ['marker_two', 5]);

    const run = call(a, 'runMonitoringReport', { params: { reportId: report.id } });

    expect(await run.run()).toMatchObject({ result: { status: 'withheld' } });
    expect(run.wrote.audit).toMatchObject([{ action: 'insight.monitoring_report.run' }]);
  });

  it('applies the tenant’s own rule, and names its version', async () => {
    const tenant = await staff();
    await call(tenant, 'updateDisclosureRule', { body: { threshold: 15, minimumGroup: 30 } }).run();
    const { report } = await made(tenant);
    answer = group(['marker_one', 40], ['marker_two', 12], ['marker_three', 30]);

    const response = (await call(tenant, 'runMonitoringReport', {
      params: { reportId: report.id },
    }).run()) as { disclosureRule: object; result: { table: { rows: { total: object }[] } } };

    expect(response.disclosureRule).toEqual({ version: 1, threshold: 15, minimumGroup: 30 });
    expect(response.result.table.rows[1]?.total).toEqual({ suppressed: true });
  });

  it('is refused while grants is off, with no audit event and nothing counted', async () => {
    const { report } = await made(a);
    answer = { status: 'grants_off' };

    const run = call(a, 'runMonitoringReport', { params: { reportId: report.id } });

    await expect(run.run()).rejects.toThrow(serverRefusals.needsGrants);
    expect(run.wrote.audit).toEqual([]);
  });

  it('is refused for a warehouse report, an archived one and a breakdown it cannot count', async () => {
    const warehouse = await made(a, warehouseBody());
    const archived = await made(a);
    await call(a, 'archiveReportDefinition', { params: { reportId: archived.report.id } }).run();
    const stage = await made(a, monitoringBody({ groupBy: { [randomUUID()]: 'stage_reached' } }));
    asked.length = 0;

    for (const [report, message] of [
      [warehouse.report, insightRefusals.notMonitoring],
      [archived.report, insightRefusals.archived],
      [stage.report, serverRefusals.oneRound],
    ] as const) {
      await expect(
        call(a, 'runMonitoringReport', { params: { reportId: report.id } }).run(),
      ).rejects.toThrow(message);
    }
    expect(asked).toEqual([]);
  });

  it('counts only the tenant’s own report, never another’s answers', async () => {
    const { report } = await made(a);
    answer = group(['marker_one', 40], ['marker_two', 30]);
    asked.length = 0;

    await expect(
      call(b, 'runMonitoringReport', { params: { reportId: report.id } }).run(),
    ).rejects.toMatchObject({
      status: 404,
    });
    expect(asked).toEqual([]);
  });
});

const runRows = (who: Staff) =>
  asMigrator<Record<string, unknown>>(
    who,
    `SELECT id, report_id, report_version, kind, outcome, disclosure_rule_version, question,
            breakdown, filter_field, filter_id, round_ids, population, shown_table, created_by
       FROM insight.report_run ORDER BY created_at, id`,
  );

const rowsOf = (...rows: Record<string, string | number | boolean | null>[]): WarehouseRead => ({
  status: 'rows',
  columns: [...new Set(rows.flatMap((row) => Object.keys(row)))],
  rows,
});

interface Result {
  run: { id: string; outcome: string; kind: string };
  columns: { itemId: string; role: string }[];
  rows: unknown[][];
  truncated: boolean;
}

describe('a warehouse run', () => {
  const [byStatus, count, amount] = [randomUUID(), randomUUID(), randomUUID()];
  const applications = () =>
    rowsOf(
      ...['submitted', 'submitted', 'withdrawn', 'decided', 'submitted', 'decided'].map(
        (status) => ({ id: randomUUID(), status }),
      ),
    );
  const body = (change: object): ReportDefinitionInput => ({
    kind: 'warehouse',
    name: `Run ${randomUUID()}`,
    description: null,
    source: 'grants_application',
    measures: { [count]: 'count' },
    groupBy: {},
    filters: {},
    ...change,
  });

  const run = async (who: Staff, change: object) => {
    const { report } = await made(who, body(change));
    const attempt = call(who, 'runReport', { params: { reportId: report.id } });
    return { report, ...attempt, result: () => attempt.run() as Promise<Result> };
  };

  it('counts and groups the warehouse rows, filtered, and keeps only who ran it', async () => {
    const t = await staff();
    warehouse = applications();
    const { report, result, wrote } = await run(t, {
      groupBy: { [byStatus]: 'status' },
      filters: { [randomUUID()]: { field: 'status', operator: 'ne', value: 'withdrawn' } },
    });

    const response = await result();

    expect(response.columns).toEqual([
      { itemId: byStatus, role: 'group' },
      { itemId: count, role: 'measure' },
    ]);
    expect(response.rows).toEqual([
      ['decided', 2],
      ['submitted', 3],
    ]);
    expect(response.truncated).toBe(false);
    expect(response.run).toMatchObject({ kind: 'warehouse', outcome: 'shown', reportVersion: 1 });
    expect(wrote.audit).toEqual([
      {
        action: 'insight.report.run',
        entityId: report.id,
        changes: { 'insight.report_definition.version': { after: 1 } },
      },
    ]);
    expect(await runRows(t)).toMatchObject([
      {
        id: response.run.id,
        kind: 'warehouse',
        outcome: 'shown',
        created_by: t.member,
        shown_table: null,
        population: null,
        round_ids: null,
        question: null,
      },
    ]);
  });

  it('adds up, takes the least and most, and averages the values that are there', async () => {
    const t = await staff();
    warehouse = rowsOf(
      { currency: 'GBP', amount_minor: 100, committed_on: '2026-04-01' },
      { currency: 'GBP', amount_minor: 250, committed_on: '2026-05-01' },
      { currency: 'GBP', amount_minor: 400, committed_on: '2026-06-01' },
      { currency: 'GBP', amount_minor: null, committed_on: '2026-07-01' },
      { currency: 'USD', amount_minor: 10, committed_on: '2026-04-01' },
      { currency: 'USD', amount_minor: 99, committed_on: '2026-09-01' },
    );
    // A report keeps its items in the order of their ids, as the database sorts a document's keys.
    const ids = [1, 2, 3, 4, 5].map((n) => `00000000-0000-4000-8000-00000000000${n}`);
    const { result } = await run(t, {
      source: 'commitment',
      groupBy: { [byStatus]: 'currency' },
      measures: {
        [ids[0] as string]: 'sum.amount_minor',
        [ids[1] as string]: 'min.amount_minor',
        [ids[2] as string]: 'max.amount_minor',
        [ids[3] as string]: 'average.amount_minor',
        [ids[4] as string]: 'count',
      },
      filters: { [amount]: { field: 'committed_on', operator: 'lt', value: '2026-08-01' } },
    });

    expect((await result()).rows).toEqual([
      ['GBP', 750, 100, 400, 250, 4],
      ['USD', 10, 10, 10, 10, 1],
    ]);
  });

  it('answers one row of totals with no grouping, and says when it cuts a long answer', async () => {
    const t = await staff();
    warehouse = rowsOf({ amount_minor: null });
    const [first, second] = [1, 2].map((n) => `00000000-0000-4000-8000-00000000000${n}`);
    const totals = await run(t, {
      source: 'commitment',
      measures: { [first as string]: 'count', [second as string]: 'sum.amount_minor' },
    });
    expect((await totals.result()).rows).toEqual([[1, null]]);

    warehouse = rowsOf(...Array.from({ length: 1001 }, () => ({ id: randomUUID() })));
    const long = await run(t, { groupBy: { [byStatus]: 'id' } });
    const response = await long.result();
    expect(response.rows).toHaveLength(1000);
    expect(response.truncated).toBe(true);
  });

  it('is refused for what it cannot read, and a refusal records no run', async () => {
    const t = await staff();
    const monitoring = await made(t);
    const archived = await run(t, {});
    await call(t, 'archiveReportDefinition', { params: { reportId: archived.report.id } }).run();
    const unknownColumn = await run(t, { groupBy: { [byStatus]: 'applicant_person_id' } });

    for (const [report, state, message] of [
      [monitoring.report.id, applications(), insightRefusals.monitoringOnly],
      [archived.report.id, applications(), insightRefusals.archived],
      [unknownColumn.report.id, rowsOf({ id: randomUUID() }), serverRefusals.columnUnavailable],
      [unknownColumn.report.id, { status: 'off' } as const, serverRefusals.sourceOff],
      [
        unknownColumn.report.id,
        { status: 'unavailable' } as const,
        serverRefusals.sourceUnavailable,
      ],
    ] as const) {
      warehouse = state;
      const attempt = call(t, 'runReport', { params: { reportId: report } });
      await expect(attempt.run()).rejects.toThrow(message);
      expect(attempt.wrote.audit).toEqual([]);
    }
    expect(await runRows(t)).toEqual([]);
  });

  it('is read back without a figure, by the tenant that ran it alone', async () => {
    const t = await staff();
    warehouse = applications();
    const { result } = await run(t, {});
    const { run: ran } = await result();
    const params = { runId: ran.id };

    expect(await call(t, 'getReportRun', { params }).run()).toEqual({
      id: ran.id,
      reportId: expect.any(String) as string,
      reportVersion: 1,
      kind: 'warehouse',
      outcome: 'shown',
      disclosureRuleVersion: null,
      ranAt: expect.any(String) as string,
      ranByMembershipId: t.member,
    });
    for (const [who, name, runId] of [
      [t, 'getMonitoringReportRun', ran.id],
      [b, 'getReportRun', ran.id],
      [t, 'getReportRun', randomUUID()],
    ] as const) {
      await expect(call(who, name, { params: { runId } }).run()).rejects.toMatchObject({
        status: 404,
      });
    }
    const outside = call(b, 'runReport', { params: { reportId: randomUUID() } });
    tablesAsked.length = 0;
    await expect(outside.run()).rejects.toMatchObject({ status: 404 });
    expect(tablesAsked).toEqual([]);
  });
});

describe('the run log', () => {
  const options = (...counts: number[]): MonitoringCounts => ({
    status: 'counted',
    rounds: [
      {
        roundId: round,
        responses: counts.reduce((total, n) => total + n, 0),
        questions: [
          {
            fieldId: 'f_group',
            options: counts.map((count, index) => ({ value: `marker_${index}`, count })),
          },
        ],
      },
    ],
  });

  const monitor = async (who: Staff, counts: MonitoringCounts, reportId?: string) => {
    answer = counts;
    const id = reportId ?? (await made(who)).report.id;
    const attempt = call(who, 'runMonitoringReport', { params: { reportId: id } });
    return { id, ...attempt, result: () => attempt.run() as Promise<{ runId: string }> };
  };

  it('keeps the table it showed, with its rounds and responses and no small count', async () => {
    const t = await staff();
    const first = await monitor(t, options(40, 3, 17));
    const response = await first.result();

    const [stored] = await runRows(t);
    expect(stored).toMatchObject({
      id: response.runId,
      report_id: first.id,
      kind: 'monitoring',
      outcome: 'shown',
      disclosure_rule_version: null,
      question: 'f_group',
      breakdown: null,
      filter_field: 'round',
      filter_id: round,
      round_ids: [round],
      population: 60,
    });
    const text = JSON.stringify(await runRows(t)) + JSON.stringify(first.wrote);
    expect(text).not.toMatch(/"count":(3|17)\b/);
    expect(text).toContain('"count":40');
    expect(
      await call(t, 'getMonitoringReportRun', { params: { runId: response.runId } }).run(),
    ).toMatchObject({ outcome: 'shown', kind: 'monitoring', ranByMembershipId: t.member });
  });

  it('keeps a table withheld as a run with no table', async () => {
    const t = await staff();
    const withheld = await monitor(t, options(8, 5));
    await withheld.result();

    expect(await runRows(t)).toMatchObject([
      {
        outcome: 'withheld',
        shown_table: null,
        population: null,
        round_ids: null,
        question: 'f_group',
      },
    ]);
  });

  it('refuses a run that, set against an earlier one, would show a small group, and keeps the refusal', async () => {
    const t = await staff();
    const first = await monitor(t, options(40, 30));
    await first.result();

    // Five more responses: five people in a cell, and in the whole.
    const second = await monitor(t, options(45, 30), first.id);
    const response = (await second.result()) as unknown as { result: object };
    expect(response.result).toEqual({ status: 'withheld' });
    expect(second.after).toHaveLength(1);
    const refused = await (second.after[0] as () => Promise<void>)().catch(
      (error: unknown) => error,
    );
    expect((refused as Error).message).toBe(insightRefusals.monitoringRefused);
    expect((refused as Error).message).not.toMatch(/\d/);
    expect(second.wrote.audit).toEqual([
      {
        action: 'insight.monitoring_report.refused',
        entityId: first.id,
        changes: {
          'insight.report_definition.version': { after: 1 },
          'insight.disclosure_rule.version': { after: null },
        },
      },
    ]);
    expect((await runRows(t)).map((row) => row.outcome)).toEqual(['shown', 'refused']);
    expect((await runRows(t))[1]).toMatchObject({ shown_table: null, population: null });
    expect(JSON.stringify(second.wrote)).not.toMatch(/marker_/);

    // A repeat of the first figures shows nothing new, and a wide step is far from every cell.
    for (const counts of [options(40, 30), options(40, 55)]) {
      const again = await monitor(t, counts, first.id);
      await again.result();
      expect(again.after).toEqual([]);
    }
    expect((await runRows(t)).map((row) => row.outcome)).toEqual([
      'shown',
      'refused',
      'shown',
      'shown',
    ]);
  });

  it('refuses a cell that moved by a few people even when the whole moved by many', async () => {
    const t = await staff();
    const first = await monitor(t, options(40, 30));
    await first.result();

    const second = await monitor(t, options(60, 35), first.id);
    await second.result();

    expect(second.after).toHaveLength(1);
    expect((await runRows(t)).map((row) => row.outcome)).toEqual(['shown', 'refused']);
  });

  it('compares only the tenant’s own runs, of the same table', async () => {
    const t = await staff();
    const other = await staff();
    const first = await monitor(t, options(40, 30));
    await first.result();

    const elsewhere = await monitor(other, options(45, 30));
    await elsewhere.result();
    const another = await monitor(t, options(45, 30));
    await another.result();

    expect(elsewhere.after).toEqual([]);
    expect(another.after).toHaveLength(1);
    expect((await runRows(other)).map((row) => row.outcome)).toEqual(['shown']);
  });
});
