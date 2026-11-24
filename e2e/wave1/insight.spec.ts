// SPDX-License-Identifier: AGPL-3.0-or-later
//
// insight in the all-tools funder: an analyst runs an equality monitoring report
// against the seed's designed answers (ADR 0032). The counts are designed
// around the platform floor (threshold 10, minimum group 20), so a report that
// forgot to suppress would show who answered what:
//
//   Spring 2026, ethnic group: "mixed" has 3 answers, so a second cell is hidden too
//   Spring 2026, age: 25 to 34 has 1 and 35 to 44 has 9, both hidden
//   Summer 2026: 8 responses, under the minimum group, so nothing is shown
//
// A hidden cell reads "Fewer than 10" in words; no number, chart value or
// accessible name lets one be worked out. The spec never adds up a hidden cell.

import { randomUUID } from 'node:crypto';

import type { Api } from '../support/api.ts';
import { axePages } from '../support/axe.ts';
import {
  ABSENT,
  asSlug,
  auditReader,
  jsonOf,
  call,
  eventsAbout,
  expect,
  keyed,
  membershipOf,
  onWave1,
  signInAs,
  staffName,
  test,
} from './support.ts';

onWave1();

const slug = 'linnetford';
const THRESHOLD = 10;

type Cell = { suppressed: true } | { suppressed: false; count: number };

interface Line {
  cells: Cell[];
  total: Cell;
}

interface Report {
  runId: string;
  disclosureRule: { threshold: number; minimumGroup: number };
  result:
    | { status: 'withheld' }
    | { status: 'shown'; table: { rows: (Line & { option: string })[]; totals: Line } };
}

let analyst: Api;
let manager: Api;
let reviewer: Api;
let reader: Api;
let rounds: Record<string, string> = {};
const reports: Record<string, string> = {};

async function makeReport(question: string, round: string, name: string): Promise<string> {
  const made = await keyed(analyst, 'POST', '/console/reports', {
    kind: 'monitoring',
    name,
    description: null,
    source: question,
    groupBy: {},
    filters: { [randomUUID()]: { field: 'round', operator: 'eq', value: rounds[round] } },
  });
  return (await jsonOf<{ id: string }>(made, 201)).id;
}

const run = async (reportId: string) =>
  await jsonOf<Report>(call(analyst, 'POST', `/console/reports/${reportId}/monitoring-runs`));

/** The rows by option, for a table that is shown. */
function rowsOf(report: Report): Map<string, Cell> {
  if (report.result.status !== 'shown') throw new Error('The report is not shown.');
  return new Map(report.result.table.rows.map((row) => [row.option, row.total]));
}

test.describe('insight: the monitoring report hides small numbers, and nothing leaks around it', () => {
  test.beforeAll(async () => {
    analyst = await signInAs(slug, 'analyst');
    manager = await signInAs(slug, 'programme_manager');
    reviewer = await signInAs(slug, 'reviewer');
    reader = await auditReader(slug);
    const { programmes } = await jsonOf<{
      programmes: { title: string; rounds: { id: string; title: string }[] }[];
    }>(call(manager, 'GET', '/console/programmes'));
    const fund = programmes.find(({ title }) => title === 'Neighbourhood Fund');
    rounds = Object.fromEntries((fund?.rounds ?? []).map(({ title, id }) => [title, id]));
    expect(Object.keys(rounds).sort()).toEqual(['Spring 2026', 'Summer 2026']);
  });

  test.afterAll(async () => {
    await Promise.all([analyst, manager, reviewer, reader].map((session) => session.dispose()));
  });

  test('a manager and a reviewer are denied the monitoring report', async () => {
    const id = ABSENT;
    expect((await call(manager, 'POST', `/console/reports/${id}/monitoring-runs`)).status).toBe(
      403,
    );
    expect((await call(reviewer, 'GET', '/console/reports')).status).toBe(403);
    expect((await call(reviewer, 'POST', `/console/reports/${id}/monitoring-runs`)).status).toBe(
      403,
    );
  });

  test('the funder applies the platform floor', async () => {
    const admin = await signInAs(slug, 'tenant_admin');
    try {
      const rule = await jsonOf<{ threshold: number; minimumGroup: number }>(
        call(admin, 'GET', '/console/disclosure-rule'),
      );
      expect(rule).toMatchObject({ threshold: THRESHOLD, minimumGroup: 20 });
    } finally {
      await admin.dispose();
    }
  });

  test('ethnic group: the small cell is hidden, a second is hidden with it, and no hidden cell has a number', async () => {
    reports['ethnic'] = await makeReport('f_ethnicgroup', 'Spring 2026', 'Ethnic group, spring');
    const report = await run(reports['ethnic']);
    const rows = rowsOf(report);
    expect(rows.get('mixed')).toEqual({ suppressed: true });
    const hidden = [...rows.values()].filter((cell) => cell.suppressed);
    expect(hidden.length, 'secondary suppression hides a second cell').toBeGreaterThanOrEqual(2);

    for (const cell of rows.values()) {
      if (!cell.suppressed) expect(cell.count === 0 || cell.count >= THRESHOLD).toBe(true);
      else expect(Object.keys(cell)).toEqual(['suppressed']);
    }
    // What is hidden, by what is shown alone: at least the threshold, or it could be found.
    if (report.result.status === 'shown' && !report.result.table.totals.total.suppressed) {
      const total = report.result.table.totals.total.count;
      const shown = [...rows.values()].reduce(
        (sum, cell) => sum + (cell.suppressed ? 0 : cell.count),
        0,
      );
      expect(total - shown).toBeGreaterThanOrEqual(THRESHOLD);
    }
  });

  test('age: both small cells are hidden and the rest are shown', async () => {
    reports['age'] = await makeReport('f_agegroup', 'Spring 2026', 'Age, spring');
    const rows = rowsOf(await run(reports['age']));
    expect(rows.get('25_34')).toEqual({ suppressed: true });
    expect(rows.get('35_44')).toEqual({ suppressed: true });
    expect(rows.get('45_54')).toEqual({ suppressed: false, count: 10 });
    expect(rows.get('65_over')).toEqual({ suppressed: false, count: 12 });
  });

  test('a round under the minimum group shows nothing at all', async () => {
    const summer = await makeReport('f_sex', 'Summer 2026', 'Sex, summer');
    expect((await run(summer)).result).toEqual({ status: 'withheld' });
  });

  test('@a11y the page says "Fewer than 10" and no text or accessible name gives a hidden count away', async ({
    pages,
  }) => {
    const page = await pages.staff(staffName(slug, 'analyst'), asSlug(slug));
    await axePages(page, [`/${slug}/insight?view=report&id=${reports['ethnic'] ?? ''}`]);
    await page.getByRole('button', { name: 'Run report' }).click();
    const table = page.getByRole('region', { name: /, table$/ });
    await expect(table).toBeVisible();
    await expect(table.getByText('Fewer than 10').first()).toBeVisible();

    const cells = await table.locator('tbody').innerText();
    expect(cells, 'the hidden count of 3').not.toMatch(/\b3\b/);
    const names = await page
      .getByRole('main')
      .locator('[aria-label], [aria-valuetext], title')
      .evaluateAll((nodes) =>
        nodes.map(
          (node) =>
            `${node.getAttribute('aria-label') ?? ''} ${node.getAttribute('aria-valuetext') ?? ''}`,
        ),
      );
    expect(names.filter((name) => /\b3\b/.test(name))).toEqual([]);
    await axePages(page, [`/${slug}/insight?view=disclosure`]);
  });

  test('each run is read back as an event with the analyst as actor, and holds no count', async () => {
    const report = await run(reports['ethnic'] ?? '');
    const events = await eventsAbout(reader, slug, 'insight.monitoring_report.run', report.runId);
    expect(events).toHaveLength(1);
    expect(events[0]?.actor.membershipId).toBe(await membershipOf(analyst));
    expect(JSON.stringify(events[0])).not.toMatch(/"(count|total)"/);
    const log = await call(analyst, 'GET', `/console/monitoring-report-runs/${report.runId}`);
    expect(log.status).toBe(200);
    expect(log.text).not.toContain('f_ethnicgroup');
  });

  test('no monitoring answer appears in a crm or grants response', async () => {
    const answers = [
      /f_ethnicgroup/,
      /f_agegroup/,
      /f_sex\b/,
      /prefer_not_to_say/,
      /monitoring_response/,
    ];
    for (const path of [
      '/console/programmes',
      `/console/programmes/${(await programmeId()) ?? ''}`,
      `/console/programmes/${(await programmeId()) ?? ''}/rounds`,
    ]) {
      const answer = await call(manager, 'GET', path);
      expect(answer.status, path).toBe(200);
      for (const pattern of answers)
        expect(answer.text, `${path} ${String(pattern)}`).not.toMatch(pattern);
    }
    const search = await call(manager, 'POST', '/console/crm/search', { term: 'Trust' });
    expect(search.status).toBe(200);
    for (const pattern of answers) expect(search.text).not.toMatch(pattern);
  });
});

async function programmeId(): Promise<string | undefined> {
  const { programmes } = await jsonOf<{ programmes: { id: string; title: string }[] }>(
    call(manager, 'GET', '/console/programmes'),
  );
  return programmes.find(({ title }) => title === 'Neighbourhood Fund')?.id;
}
