// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The insight routes through the whole API against the test database, as
// app_api: sessions, the policy, row-level security, grants' own counts, the
// warehouse's rows, configuration versions and the audit log, for two tenants.
// The disclosure engine and the run log are tested with the module's handlers
// (modules/insight), where the counts can be set.

import { randomUUID } from 'node:crypto';

import { insightRefusals } from '@pixel-scientists/insight/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createTestTenant } from '../../../../packages/db/test/tenants.ts';
import { switchModule } from '../../test/modules-on.ts';
import {
  answer,
  rowsOf,
  startProgrammeApi,
  type Method,
  type ProgrammeApi,
} from '../../test/programme-api.ts';
import {
  addMember,
  events,
  versions as allConfigVersions,
  type Member,
} from '../../test/settings-api.ts';
import { expectLooksMissing } from '../../test/support.ts';

// Each request runs a few statements in a transaction, which is slow on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

const REPORTS = '/console/reports';

interface Report {
  id: string;
  kind: string;
  version: number;
  archivedAt: string | null;
}

interface Run {
  id: string;
  outcome: string;
  kind: string;
  ranByMembershipId: string;
}

let t: ProgrammeApi;
let tenantOff: Awaited<ReturnType<typeof createTestTenant>>;
let analystA: Member;
let analystB: Member;
let analystOff: Member;

beforeAll(async () => {
  t = await startProgrammeApi('41420');
  await switchModule(t.tenantA, 'insight');
  await switchModule(t.tenantB, 'insight');
  tenantOff = await createTestTenant();
  [analystA, analystB, analystOff] = await Promise.all([
    addMember(t.tenantA, 'console', 'analyst'),
    addMember(t.tenantB, 'console', 'analyst'),
    addMember(tenantOff, 'console', 'analyst'),
  ]);
}, 60_000);

afterAll(async () => {
  await t.close();
});

const send = (method: Method, url: string, body?: unknown, member: Member = analystA) =>
  t.send(member, method, url, body);

const warehouseReport = (change: object = {}) => ({
  kind: 'warehouse',
  name: `Programmes ${randomUUID()}`,
  description: null,
  source: 'programme',
  measures: { [randomUUID()]: 'count' },
  groupBy: { [randomUUID()]: 'status' },
  filters: {},
  ...change,
});

const monitoringReport = (change: object = {}) => ({
  kind: 'monitoring',
  name: `Ethnic group ${randomUUID()}`,
  description: null,
  source: 'f_group',
  groupBy: {},
  filters: { [randomUUID()]: { field: 'round', operator: 'eq', value: randomUUID() } },
  ...change,
});

const aReport = (body: object = warehouseReport(), member: Member = analystA) =>
  answer<Report>(send('POST', REPORTS, body, member), 201);

const counts = () =>
  rowsOf<Record<string, number>>(
    t.tenantA,
    `SELECT (SELECT count(*) FROM insight.report_definition)::int AS reports,
            (SELECT count(*) FROM insight.report_run)::int AS runs,
            (SELECT count(*) FROM insight.disclosure_rule)::int AS rules,
            (SELECT count(*) FROM app.config_version)::int AS configs,
            (SELECT count(*) FROM app.audit_event WHERE action LIKE 'insight.%')::int AS events`,
  );

/** Every route that has a handler, with a valid request for the ids given. */
function everyRoute(reportId: string, runId: string): [Method, string, unknown][] {
  return [
    ['GET', REPORTS, undefined],
    ['POST', REPORTS, warehouseReport()],
    ['GET', `${REPORTS}/${reportId}`, undefined],
    ['PUT', `${REPORTS}/${reportId}`, warehouseReport()],
    ['POST', `${REPORTS}/${reportId}/archive`, undefined],
    ['POST', `${REPORTS}/${reportId}/runs`, undefined],
    ['GET', `/console/report-runs/${runId}`, undefined],
    ['POST', `${REPORTS}/${reportId}/monitoring-runs`, undefined],
    ['GET', `/console/monitoring-report-runs/${runId}`, undefined],
    ['GET', '/console/publication-runs', undefined],
    ['GET', `/console/publication-runs/${runId}`, undefined],
    ['POST', `/console/publication-runs/${runId}/mark-submitted`, undefined],
    ['GET', '/console/disclosure-rule', undefined],
    ['PUT', '/console/disclosure-rule', { threshold: 12, minimumGroup: 25 }],
    ['GET', '/console/data-contracts', undefined],
  ];
}

describe('who may use the insight routes', () => {
  it('refuse a reviewer, an applicant and a signed-out caller on every route, and change nothing', async () => {
    const report = await aReport();
    const before = await counts();
    const routes = everyRoute(report.id, randomUUID());
    expect(routes).toHaveLength(15);

    for (const [method, url, body] of routes) {
      for (const [who, member] of [
        ['a reviewer', t.reviewerA],
        ['an applicant', t.applicantA],
      ] as const) {
        const response = await send(method, url, body, member);
        expect(response.statusCode, `${method} ${url} as ${who}`).toBe(403);
      }
      const inPortal = await t.send(analystA, method, url, body, 'portal');
      expect(inPortal.statusCode, `${method} ${url} in the portal`).toBe(403);
      const signedOut = await t.send(undefined, method, url, body);
      expect(signedOut.statusCode, `${method} ${url} signed out`).toBe(401);
    }
    expect(await counts()).toEqual(before);
  });

  it('keep each permission to its own role', async () => {
    const report = await aReport();
    const monitoring = await aReport(monitoringReport());
    const before = await counts();
    const [get, make, run, monitor, rule] = [
      [`${REPORTS}/${report.id}`, 'GET'],
      [REPORTS, 'POST', warehouseReport()],
      [`${REPORTS}/${report.id}/runs`, 'POST'],
      [`${REPORTS}/${monitoring.id}/monitoring-runs`, 'POST'],
      ['/console/disclosure-rule', 'GET'],
    ] as const;

    // A programme manager reads and runs reports, and nothing that changes or discloses.
    const manager = t.managerA;
    expect((await send(get[1], get[0], undefined, manager)).statusCode).toBe(200);
    expect((await send(run[1], run[0], undefined, manager)).statusCode).toBe(200);
    for (const [url, method, body] of [make, monitor, rule]) {
      const response = await send(method, url, body, manager);
      expect(response.statusCode, `${method} ${url}`).toBe(403);
    }
    // An administrator sets the rule and cannot run a monitoring report.
    expect((await send('GET', rule[0], undefined, t.adminA)).statusCode).toBe(200);
    expect((await send('POST', monitor[0], undefined, t.adminA)).statusCode).toBe(403);
    // An analyst cannot read or change the rule.
    expect((await send('GET', rule[0])).statusCode).toBe(403);
    const [after] = await counts();
    expect(after).toMatchObject({ reports: before[0]?.['reports'], rules: before[0]?.['rules'] });
  });

  it('answer 404 on every route while insight is off, and keep the rows', async () => {
    for (const [method, url, body] of everyRoute(randomUUID(), randomUUID())) {
      const response = url.endsWith('/disclosure-rule')
        ? await t.send(
            await addMember(tenantOff, 'console', 'tenant_admin'),
            method,
            url,
            body,
            'console',
            new Date(),
          )
        : await send(method, url, body, analystOff);
      expect(response.statusCode, `${method} ${url}`).toBe(404);
    }
    expect(
      await rowsOf(tenantOff, 'SELECT count(*)::int AS n FROM insight.report_definition'),
    ).toEqual([{ n: 0 }]);
  });
});

describe('another tenant’s reports', () => {
  it('read as missing on every route that takes an id, and nothing of theirs changes', async () => {
    const report = await aReport();
    const ran = await answer<{ run: Run }>(send('POST', `${REPORTS}/${report.id}/runs`));
    const monitoring = await aReport(monitoringReport());
    const monitored = await answer<{ runId: string }>(
      send('POST', `${REPORTS}/${monitoring.id}/monitoring-runs`),
    );
    const before = await counts();
    const real = [
      ...everyRoute(report.id, ran.run.id),
      ['GET', `/console/monitoring-report-runs/${monitored.runId}`, undefined] as const,
    ];
    const absent = [
      ...everyRoute(randomUUID(), randomUUID()),
      ['GET', `/console/monitoring-report-runs/${randomUUID()}`, undefined] as const,
    ];

    let withId = 0;
    for (const [index, [method, url, body]] of real.entries()) {
      if (
        !/\/(reports|report-runs|monitoring-report-runs|publication-runs)\/[0-9a-f-]{36}/.test(url)
      ) {
        continue;
      }
      withId += 1;
      const outside = await send(method, url, body, analystB);
      const missing = await send(method, absent[index]?.[1] ?? '', absent[index]?.[2], analystB);
      expect(outside.statusCode, `${method} ${url}`).toBe(404);
      expectLooksMissing(outside, missing);
    }
    expect(withId).toBe(10);
    const listed = await answer<{ reports: unknown[] }>(send('GET', REPORTS, undefined, analystB));
    expect(listed.reports).toEqual([]);
    expect(await counts()).toEqual(before);
  });

  it('keep their own disclosure rule', async () => {
    const stepUp = (member: Member) =>
      t.send(
        member,
        'PUT',
        '/console/disclosure-rule',
        { threshold: 15, minimumGroup: 40 },
        'console',
        new Date(),
      );
    const adminB = await addMember(t.tenantB, 'console', 'tenant_admin');

    expect((await stepUp(adminB)).statusCode).toBe(200);

    const mine = await answer<{ version: number | null; threshold: number }>(
      send('GET', '/console/disclosure-rule', undefined, t.adminA),
    );
    expect(mine.threshold).toBe(10);
  });
});

describe('a report', () => {
  it('is made with a configuration version and an audit event, and a replay makes nothing more', async () => {
    const key = randomUUID();
    const body = warehouseReport({ name: 'Private report name' });
    const post = () => t.send(analystA, 'POST', REPORTS, body, 'console', null, key);

    const first = await post();
    const replay = await post();

    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    const { id } = first.json<Report>();
    expect(replay.json<Report>().id).toBe(id);
    const stored = (await allConfigVersions(t.tenantA, 'insight.report_definition')).filter(
      (row) => row.entity_id === id,
    );
    expect(stored).toHaveLength(1);
    const created = (await events(t.tenantA, 'insight.report_definition.created')).filter(
      (event) => event.entity_id === id,
    );
    expect(created).toMatchObject([{ actor_id: analystA.membershipId }]);
  });

  it('is run from the warehouse, and is read back without its figures', async () => {
    await t.aProgramme();
    await t.aProgramme({ title: 'Second fund' });
    const report = await aReport();

    const result = await answer<{
      run: Run;
      columns: { role: string }[];
      rows: unknown[][];
      truncated: boolean;
    }>(send('POST', `${REPORTS}/${report.id}/runs`));

    expect(result.columns.map(({ role }) => role)).toEqual(['group', 'measure']);
    expect(result.rows).toEqual([['draft', expect.any(Number)]]);
    expect(result.rows[0]?.[1]).toBeGreaterThanOrEqual(2);
    expect(result.run).toMatchObject({ kind: 'warehouse', outcome: 'shown' });

    const read = await answer<Run>(send('GET', `/console/report-runs/${result.run.id}`));
    expect(read).toMatchObject({ id: result.run.id, ranByMembershipId: analystA.membershipId });
    expect(JSON.stringify(read)).not.toMatch(/draft/);
    const stored = await rowsOf<{ shown_table: unknown; population: unknown }>(
      t.tenantA,
      'SELECT shown_table, population FROM insight.report_run WHERE id = $1',
      [result.run.id],
    );
    expect(stored).toEqual([{ shown_table: null, population: null }]);
    const audited = (await events(t.tenantA, 'insight.report.run')).filter(
      (event) => event.entity_id === report.id,
    );
    expect(audited).toMatchObject([{ actor_id: analystA.membershipId }]);
  });

  it('is not run once archived', async () => {
    const archived = await aReport();
    await answer(send('POST', `${REPORTS}/${archived.id}/archive`));

    const run = await send('POST', `${REPORTS}/${archived.id}/runs`);

    expect(run.statusCode).toBe(409);
    expect(run.json<{ detail: string }>().detail).toBe(insightRefusals.archived);
  });
});

describe('an equality monitoring report', () => {
  it('runs against grants with no closed round as a withheld table, kept as a run with no figure', async () => {
    const report = await aReport(monitoringReport());

    const response = await answer<{
      runId: string;
      result: { status: string };
      disclosureRule: { version: number | null };
    }>(send('POST', `${REPORTS}/${report.id}/monitoring-runs`));

    expect(response.result).toEqual({ status: 'withheld' });
    const read = await answer<Run>(
      send('GET', `/console/monitoring-report-runs/${response.runId}`),
    );
    expect(read).toMatchObject({ outcome: 'withheld', kind: 'monitoring' });
    expect(
      await rowsOf(
        t.tenantA,
        'SELECT shown_table, population, round_ids FROM insight.report_run WHERE id = $1',
        [response.runId],
      ),
    ).toEqual([{ shown_table: null, population: null, round_ids: null }]);
    const audited = (await events(t.tenantA, 'insight.monitoring_report.run')).filter(
      (event) => event.entity_id === report.id,
    );
    expect(audited).toHaveLength(1);
    expect(JSON.stringify(audited)).not.toMatch(/f_group/);
    // A warehouse run is not a monitoring run, and the reverse.
    expect((await send('GET', `/console/report-runs/${response.runId}`)).statusCode).toBe(404);
  });

  it('is refused while grants is off, and is not run from the reports page', async () => {
    const report = await aReport(monitoringReport());
    await switchModule(t.tenantA, 'grants', false);
    try {
      const off = await send('POST', `${REPORTS}/${report.id}/monitoring-runs`);
      expect(off.statusCode).toBe(409);
    } finally {
      await switchModule(t.tenantA, 'grants');
    }
    const wrong = await send('POST', `${REPORTS}/${report.id}/runs`);
    expect(wrong.statusCode).toBe(409);
    expect(wrong.json<{ detail: string }>().detail).toBe(insightRefusals.monitoringOnly);
  });
});

describe('the disclosure rule', () => {
  it('is raised after step-up, with a configuration version and an audit event', async () => {
    const url = '/console/disclosure-rule';
    const body = { threshold: 12, minimumGroup: 25 };

    const noStepUp = await t.send(t.adminA, 'PUT', url, body);
    expect(noStepUp.statusCode).toBe(403);
    const raised = await answer<{ version: number; threshold: number }>(
      t.send(t.adminA, 'PUT', url, body, 'console', new Date()),
    );

    expect(raised).toMatchObject({ version: 1, threshold: 12 });
    expect(await events(t.tenantA, 'insight.disclosure_rule.changed')).toMatchObject([
      { actor_id: t.adminA.membershipId },
    ]);
    expect(await allConfigVersions(t.tenantA, 'insight.disclosure_rule')).toHaveLength(1);
  });
});

describe('the publication routes', () => {
  it('list nothing for a tenant with no runs, and read an unknown run as missing', async () => {
    const url = '/console/publication-runs';

    expect(await answer(send('GET', url))).toEqual({ runs: [] });
    expect((await send('GET', `${url}/${randomUUID()}`)).statusCode).toBe(404);
    expect((await send('POST', `${url}/${randomUUID()}/mark-submitted`)).statusCode).toBe(404);
  });
});

describe('the data contracts', () => {
  it('are listed for a member who reads reports, whatever the tenant holds', async () => {
    const list = await answer<{ contracts: unknown[] }>(send('GET', '/console/data-contracts'));
    expect(Array.isArray(list.contracts)).toBe(true);
  });
});
