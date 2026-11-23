// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Insight's screens: reports and runs, a monitoring report with its hidden
// cells in words, the disclosure rule, publication runs and recording a
// submission, and the data contract pages. Synthetic data only, with the API
// stubbed (auth-api.ts). Screens are chosen by the search string of /insight.

import type { Page } from '@playwright/test';

import { expect as strictExpect, test } from '../../../scripts/e2e/fixtures.ts';
import { consoleSession, problem, stubSignedIn } from './auth-api.ts';
import type { Handler, SentRequest } from './auth-api.ts';
import { expectNoHorizontalScroll, expectNoViolations, widths } from './auth-axe.ts';

/** Each page loads its code when first opened, which a busy machine can slow past five seconds. */
const expect = strictExpect.configure({ timeout: 15_000 });

const REPORT = '33333333-3333-4333-8333-333333333333';
const RUN = '44444444-4444-4444-8444-444444444444';
const FILE = '55555555-5555-4555-8555-555555555555';
/** The member's own membership in the session stub, so the run reads "You". */
const ME = '0b8f7c1e-7a3d-4c55-9a52-2f6f1a9d4e10';
const now = '2027-04-01T10:00:00.000Z';

const permissions = [
  'insight.reports.read',
  'insight.reports.manage',
  'insight.monitoring.report',
  'insight.publications.manage',
  'insight.disclosure_rules.manage',
];

const ok = (body: unknown) => ({ status: 200, body });
const modules = ['grants', 'insight'];

const definition = {
  id: REPORT,
  kind: 'monitoring',
  name: 'Disability monitoring',
  description: null,
  source: 'disability',
  groupBy: {},
  filters: {},
  version: 2,
  archivedAt: null,
  createdAt: now,
  updatedAt: now,
};

const shown = (count: number) => ({ suppressed: false, count });

const monitoring = {
  runId: RUN,
  reportId: REPORT,
  reportVersion: 2,
  question: 'disability',
  breakdown: null,
  filter: null,
  disclosureRule: { version: 3, threshold: 10, minimumGroup: 20 },
  result: {
    status: 'shown',
    table: {
      columns: [],
      rows: [
        { option: 'yes', cells: [], total: shown(30) },
        { option: 'no', cells: [], total: { suppressed: true } },
        { option: 'prefer_not_to_say', cells: [], total: { suppressed: true } },
      ],
      totals: { cells: [], total: shown(45) },
    },
  },
};

const run = {
  id: RUN,
  kind: 'three_sixty_giving',
  periodStart: '2027-04-01',
  periodEnd: '2028-03-31',
  state: 'prepared',
  outputFileId: FILE,
  errorCode: null,
  preparedByMembershipId: ME,
  createdAt: now,
  submittedByMembershipId: null,
  submittedAt: null,
};

const rule = { version: null, threshold: 10, minimumGroup: 20, updatedAt: null };

const contracts = {
  contracts: [
    {
      module: 'grants',
      version: 1,
      tables: [
        {
          name: 'programme',
          rows: 'each programme',
          key: 'id',
          columns: [
            {
              name: 'title',
              type: 'text',
              nullable: false,
              class: 'public',
              sources: ['grants.programme.title'],
            },
          ],
        },
      ],
    },
    { module: 'crm', version: null, tables: [] },
  ],
};

interface Stub {
  sent: SentRequest[];
  /** Whether the member has confirmed it is them. Marking a run submitted is refused until they have. */
  recent: boolean;
}

async function stub(page: Page, more: Record<string, Handler> = {}): Promise<Stub> {
  const state: Stub = { sent: [], recent: false };
  state.sent = await stubSignedIn(
    page,
    { permissions, modules },
    {
      'GET /console/reports': ok({
        reports: [{ ...definition, kind: 'monitoring', archivedAt: null, updatedAt: now }],
      }),
      [`GET /console/reports/${REPORT}`]: ok(definition),
      [`POST /console/reports/${REPORT}/monitoring-runs`]: ok(monitoring),
      'GET /console/disclosure-rule': ok(rule),
      'GET /console/publication-runs': ok({ runs: [run] }),
      [`GET /console/publication-runs/${RUN}`]: ok(run),
      'GET /console/data-contracts': ok(contracts),
      'POST /auth/step-up': () => {
        state.recent = true;
        return ok({
          ...consoleSession({ permissions, modules }),
          recentAuthUntil: '2099-01-01T00:00:00.000Z',
        });
      },
      ...more,
    },
  );
  return state;
}

async function confirmItsYou(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Confirm it is you' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Password').fill('correct horse battery');
  await dialog.getByLabel('Code from your authenticator app').fill('123456');
  await dialog.getByRole('button', { name: 'Confirm it is you' }).click();
  await expect(dialog).toBeHidden();
}

const open = (page: Page, search = '') => page.goto(`/northfield/insight${search}`);
const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });

test.describe('insight reports', () => {
  test('lists reports and runs one, with hidden cells in words and no number for them', async ({
    page,
  }) => {
    const { sent } = await stub(page);
    await open(page);
    await page.getByRole('link', { name: 'Disability monitoring' }).click();
    await h1(page, 'Disability monitoring').waitFor();
    await page.getByRole('button', { name: 'Run report' }).dblclick();

    const table = page.getByRole('table', { name: /Disability monitoring: Disability/ });
    await expect(table).toBeVisible();
    await expect(table.getByText('Fewer than 10')).toHaveCount(2);
    await expect(table.getByRole('row', { name: /^No Fewer than 10$/ })).toBeVisible();
    await expect(page.getByText(/To keep people anonymous/)).toBeVisible();
    expect(sent.filter(({ key }) => key.endsWith('monitoring-runs'))).toHaveLength(1);
    expect(sent.some(({ key }) => key.startsWith('POST /console/report-runs'))).toBe(false);
  });

  test('shows the server words when a run is refused', async ({ page }) => {
    await stub(page, {
      [`POST /console/reports/${REPORT}/monitoring-runs`]: problem(
        409,
        'Choose fewer breakdowns or a wider filter.',
      ),
    });
    await open(page, `?view=report&id=${REPORT}`);
    await page.getByRole('button', { name: 'Run report' }).click();

    await expect(page.getByRole('alert', { name: 'There is a problem' })).toContainText(
      'Choose fewer breakdowns or a wider filter.',
    );
  });

  test('shows no run button for a monitoring report without the monitoring permission', async ({
    page,
  }) => {
    await stubSignedIn(
      page,
      { permissions: ['insight.reports.read'], modules },
      { [`GET /console/reports/${REPORT}`]: ok(definition) },
    );
    await open(page, `?view=report&id=${REPORT}`);

    await h1(page, 'Disability monitoring').waitFor();
    await expect(page.getByRole('button', { name: 'Run report' })).toHaveCount(0);
  });
});

test.describe('insight disclosure rule', () => {
  test('refuses a threshold below the floor, then raises it after step-up', async ({ page }) => {
    const state = await stub(page, {
      'PUT /console/disclosure-rule': () =>
        state.recent
          ? ok({ version: 1, threshold: 12, minimumGroup: 20, updatedAt: now })
          : problem(403, 'Confirm it is you again, then try again.'),
    });
    await open(page, '?view=disclosure');
    await page.getByRole('button', { name: 'Change threshold' }).click();
    await page.getByRole('textbox', { name: 'Threshold', exact: true }).fill('5');
    await page.getByRole('button', { name: 'Save threshold' }).click();
    await expect(page.getByRole('alert', { name: 'There is a problem' })).toContainText(
      'Enter a threshold of 10 or more.',
    );
    expect(state.sent.some(({ key }) => key.startsWith('PUT'))).toBe(false);

    await page.getByRole('textbox', { name: 'Threshold', exact: true }).fill('12');
    await page.getByRole('button', { name: 'Save threshold' }).click();
    await confirmItsYou(page);

    await expect(page.getByText('Fewer than 12 people are hidden')).toBeVisible();
    await expect(page.getByText('Version', { exact: true })).toBeVisible();
  });
});

test.describe('insight publication runs', () => {
  test('prepares a run, sees it become ready, downloads it and records the submission', async ({
    page,
  }) => {
    let reads = 0;
    const state = await stub(page, {
      'POST /console/publication-runs': {
        status: 201,
        body: { ...run, state: 'preparing', outputFileId: null },
      },
      [`GET /console/publication-runs/${RUN}`]: () =>
        ok((reads += 1) === 1 ? { ...run, state: 'preparing', outputFileId: null } : run),
      [`POST /console/publication-runs/${RUN}/mark-submitted`]: () =>
        state.recent
          ? ok({ ...run, state: 'submitted', submittedByMembershipId: ME, submittedAt: now })
          : problem(403, 'Confirm it is you again, then try again.'),
    });
    await open(page, '?view=publication');
    await page.getByRole('link', { name: 'Prepare a run' }).click();
    await page.getByLabel('Day').first().fill('1');
    await page.getByLabel('Month').first().fill('4');
    await page.getByLabel('Year').first().fill('2027');
    await page.getByLabel('Day').last().fill('31');
    await page.getByLabel('Month').last().fill('3');
    await page.getByLabel('Year').last().fill('2028');
    await page.getByRole('button', { name: 'Prepare a run' }).click();

    await expect(page.getByText('This can take a few minutes')).toBeVisible();
    await page.getByRole('button', { name: 'Check again' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Ready to review' })).toBeVisible();
    const download = page.getByRole('link', { name: 'Download file' });
    await expect(download).toHaveAttribute('href', new RegExp(RUN));

    await page.getByRole('button', { name: 'Mark as submitted' }).click();
    const dialog = page.getByRole('dialog', { name: 'Record that you submitted this?' });
    await expect(dialog).toContainText('The software has not sent anything');
    await dialog.getByRole('button', { name: 'Record that I submitted this' }).click();
    await confirmItsYou(page);

    await expect(page.getByText('Submitted by You on 1 April 2027').first()).toBeVisible();
    const prepare = state.sent.find(({ key }) => key === 'POST /console/publication-runs');
    expect(prepare?.body).toEqual({
      kind: 'three_sixty_giving',
      periodStart: '2027-04-01',
      periodEnd: '2028-03-31',
    });
    const marks = state.sent.filter(({ key }) => key.endsWith('mark-submitted'));
    expect(marks.length).toBeGreaterThan(0);
    expect(marks.every(({ body }) => body === undefined)).toBe(true);
  });

  test('shows no screen for publication runs without the publication permission', async ({
    page,
  }) => {
    await stubSignedIn(page, { permissions: ['insight.reports.read'], modules }, {});
    await open(page, '?view=publication');

    await expect(page.getByText('You cannot open this page')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mark as submitted' })).toHaveCount(0);
  });
});

test.describe('insight data contracts', () => {
  test('lists each module, then its tables and columns with their class', async ({ page }) => {
    await stub(page);
    await open(page, '?view=contracts');
    await page.getByRole('link', { name: 'Grants', exact: true }).click();

    await h1(page, 'Grants data contract').waitFor();
    await expect(page.getByRole('cell', { name: 'Public' })).toBeVisible();
  });
});

test.describe('insight switched off', () => {
  test('shows the not-found page and makes no insight request', async ({ page }) => {
    const sent = await stubSignedIn(
      page,
      { permissions, modules: ['grants'] },
      { 'GET /console/programmes': ok({ programmes: [] }) },
    );
    await open(page);

    await h1(page, 'Page not found').waitFor();
    expect(sent.some(({ key }) => key.includes('/console/reports'))).toBe(false);
  });
});

const screens: { name: string; search: string; ready: (page: Page) => Promise<void> }[] = [
  { name: 'the report list', search: '', ready: (page) => h1(page, 'Reports').waitFor() },
  {
    name: 'a monitoring report with its chart',
    search: `?view=report&id=${REPORT}`,
    ready: async (page) => {
      await page.getByRole('button', { name: 'Run report' }).click();
      await expect(page.locator('figure')).toBeAttached();
    },
  },
  {
    name: 'the publication list',
    search: '?view=publication',
    ready: (page) => h1(page, 'Publication runs').waitFor(),
  },
  {
    name: 'the review page with the dialog open',
    search: `?view=publication-run&id=${RUN}`,
    ready: async (page) => {
      await page.getByRole('button', { name: 'Mark as submitted' }).click();
      await expect(
        page.getByRole('dialog', { name: 'Record that you submitted this?' }),
      ).toBeVisible();
    },
  },
  {
    name: 'a data contract page',
    search: '?view=contract&module=grants',
    ready: (page) => h1(page, 'Grants data contract').waitFor(),
  },
];

for (const width of widths) {
  test.describe(`at ${width.name}`, () => {
    test.use({ viewport: width.viewport, deviceScaleFactor: width.deviceScaleFactor });

    for (const screen of screens) {
      test(`@a11y ${screen.name} has no axe violations`, async ({ page }) => {
        await stub(page);
        await open(page, screen.search);
        await screen.ready(page);
        await expect(page.locator('h1')).toHaveCount(1);

        await expectNoViolations(page);
        await expectNoHorizontalScroll(page);
      });
    }
  });
}
