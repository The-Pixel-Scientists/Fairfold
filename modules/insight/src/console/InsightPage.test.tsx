// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router, SessionProvider } from '@pixel-scientists/ui';
import type { SessionData } from '@pixel-scientists/ui';
import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import InsightPage from './InsightPage.tsx';

const ME = '11111111-1111-4111-8111-111111111111';
const REPORT = '33333333-3333-4333-8333-333333333333';
const RUN = '44444444-4444-4444-8444-444444444444';
const FILE = '55555555-5555-4555-8555-555555555555';

const allPermissions = [
  'insight.reports.read',
  'insight.reports.manage',
  'insight.monitoring.report',
  'insight.publications.manage',
  'insight.disclosure_rules.manage',
] as const;

const routes = [{ path: '/insight', title: 'Insight', component: InsightPage }];

function sessionFor(permissions: readonly string[]): SessionData {
  const membership = { id: ME, tenant: { slug: 'northfield', name: 'Northfield Foundation' } };
  return {
    mfa: 'complete',
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    recentAuthUntil: null,
    user: { email: 'ada@example.org' },
    permissions,
    activeMembership: membership,
    memberships: [membership],
  };
}

/** Shows insight at `search`, such as `?view=publication`, for a member holding `permissions`. */
function openInsight(search = '', permissions: readonly string[] = allPermissions): RenderResult {
  window.history.replaceState(null, '', `/insight${search}`);
  const session = sessionFor(permissions);
  return render(
    <SessionProvider load={() => Promise.resolve(session)} signOut={() => Promise.resolve()}>
      <Router routes={routes} />
    </SessionProvider>,
  );
}

interface Reply {
  status: number;
  body?: unknown;
}

interface Sent {
  key: string;
  body: unknown;
}

/** Answers the keys given, such as `GET /api/console/reports`, and fails on any other request. */
function stubApi(handlers: Record<string, Reply | ((body: unknown) => Reply)>): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      const key = `${init.method ?? 'GET'} ${url}`;
      const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      sent.push({ key, body });
      const handler = handlers[key];
      if (handler === undefined) return Promise.reject(new Error(`Unexpected request: ${key}`));
      const reply = typeof handler === 'function' ? handler(body) : handler;
      return Promise.resolve(
        new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
          status: reply.status,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }),
  );
  return sent;
}

const problem = (status: number, detail: string) => ({
  status,
  body: { type: 'about:blank', title: 'Problem', status, detail, requestId: 'req_test' },
});

const now = '2027-04-01T10:00:00.000Z';

const monitoringDefinition = {
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

const reportList = {
  status: 200,
  body: {
    reports: [
      {
        id: REPORT,
        kind: 'monitoring',
        name: 'Disability monitoring',
        description: null,
        version: 2,
        archivedAt: null,
        updatedAt: now,
      },
    ],
  },
};

const monitoringReport = {
  runId: RUN,
  reportId: REPORT,
  reportVersion: 2,
  question: 'disability',
  breakdown: null,
  filter: null,
  disclosureRule: { version: null, threshold: 10, minimumGroup: 20 },
  result: {
    status: 'shown',
    table: {
      columns: [],
      rows: [
        { option: 'yes', cells: [], total: { suppressed: false, count: 30 } },
        { option: 'no', cells: [], total: { suppressed: true } },
        { option: 'unknown', cells: [], total: { suppressed: true } },
      ],
      totals: { cells: [], total: { suppressed: false, count: 45 } },
    },
  },
};

const preparedRun = {
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

const membership = {
  id: ME,
  tenant: { slug: 'northfield', name: 'Northfield Foundation' },
  roles: ['programme_manager'],
};

/** What the step-up route answers: the same session, now with a recent sign-in. */
const refreshedSession = {
  user: { id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d', email: 'ada@example.org' },
  expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
  app: 'console',
  mfa: 'complete',
  recentAuthUntil: new Date(Date.now() + 300_000).toISOString(),
  activeMembership: membership,
  memberships: [membership],
  permissions: allPermissions,
  modules: ['grants', 'insight'],
};

beforeEach(() => {
  configure({ asyncUtilTimeout: 5000 });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('insight reports', () => {
  it('lists reports, with "Create report" only for a member who sets them up', async () => {
    stubApi({ 'GET /api/console/reports': reportList });
    openInsight('', allPermissions);
    expect(await screen.findByRole('link', { name: 'Disability monitoring' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Create report' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Reports' })).toBeTruthy();

    cleanup();
    stubApi({ 'GET /api/console/reports': reportList });
    openInsight('', ['insight.reports.read']);
    expect(await screen.findByRole('link', { name: 'Disability monitoring' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Create report' })).toBeNull();
  });

  it('runs a monitoring report once for a double click, with hidden cells in words', async () => {
    const sent = stubApi({
      [`GET /api/console/reports/${REPORT}`]: { status: 200, body: monitoringDefinition },
      [`POST /api/console/reports/${REPORT}/monitoring-runs`]: {
        status: 200,
        body: monitoringReport,
      },
    });
    openInsight(`?view=report&id=${REPORT}`);
    const run = await screen.findByRole('button', { name: 'Run report' });
    fireEvent.click(run);
    fireEvent.click(run);

    const table = await screen.findByRole('table');
    expect(within(table).getAllByText('Fewer than 10')).toHaveLength(2);
    expect(sent.filter(({ key }) => key.includes('monitoring-runs'))).toHaveLength(1);
  });

  it('says when a run has finished, for a screen reader', async () => {
    stubApi({
      [`GET /api/console/reports/${REPORT}`]: { status: 200, body: monitoringDefinition },
      [`POST /api/console/reports/${REPORT}/monitoring-runs`]: {
        status: 200,
        body: { ...monitoringReport, result: { status: 'withheld' } },
      },
    });
    openInsight(`?view=report&id=${REPORT}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Run report' }));

    await waitFor(() => {
      expect(screen.getAllByRole('status').map((node) => node.textContent)).toContain(
        'Report run. The figures are not shown.',
      );
    });
  });

  it('shows the words of a refused run in an error summary', async () => {
    stubApi({
      [`GET /api/console/reports/${REPORT}`]: { status: 200, body: monitoringDefinition },
      [`POST /api/console/reports/${REPORT}/monitoring-runs`]: problem(
        409,
        'Choose fewer breakdowns or a wider filter.',
      ),
    });
    openInsight(`?view=report&id=${REPORT}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Run report' }));

    const summary = await screen.findByRole('alert');
    expect(summary.textContent).toContain('Choose fewer breakdowns or a wider filter.');
  });

  it('hides "Run report" on a monitoring report from a member who cannot run it', async () => {
    stubApi({
      [`GET /api/console/reports/${REPORT}`]: { status: 200, body: monitoringDefinition },
    });
    openInsight(`?view=report&id=${REPORT}`, ['insight.reports.read']);

    await screen.findByRole('heading', { level: 1, name: 'Disability monitoring' });
    expect(screen.queryByRole('button', { name: 'Run report' })).toBeNull();
  });
});

describe('insight publication runs', () => {
  it('records the submission after step-up, sending no member, name, tenant or time', async () => {
    let attempts = 0;
    const sent = stubApi({
      [`GET /api/console/publication-runs/${RUN}`]: { status: 200, body: preparedRun },
      [`POST /api/console/publication-runs/${RUN}/mark-submitted`]: () => {
        attempts += 1;
        return attempts === 1
          ? problem(403, 'Confirm it is you again, then try again.')
          : {
              status: 200,
              body: {
                ...preparedRun,
                state: 'submitted',
                submittedByMembershipId: ME,
                submittedAt: now,
              },
            };
      },
      'POST /api/auth/step-up': { status: 200, body: refreshedSession },
    });
    openInsight(`?view=publication-run&id=${RUN}`);
    expect(await screen.findByRole('link', { name: 'Download file' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Mark as submitted' }));

    const dialog = await screen.findByRole('dialog', { name: 'Record that you submitted this?' });
    expect(dialog.textContent).toContain('The software has not sent anything');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Record that I submitted this' }),
    );

    const stepUp = await screen.findByRole('dialog', { name: 'Confirm it is you' });
    await userEvent.type(within(stepUp).getByLabelText('Password'), 'correct horse battery');
    await userEvent.type(
      within(stepUp).getByLabelText('Code from your authenticator app'),
      '123456',
    );
    await userEvent.click(within(stepUp).getByRole('button', { name: 'Confirm it is you' }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Mark as submitted' })).toBeNull();
    });
    expect(screen.getAllByText('Submitted by You on 1 April 2027').length).toBeGreaterThan(0);
    const marks = sent.filter(({ key }) => key.endsWith('mark-submitted'));
    expect(marks).toHaveLength(2);
    expect(marks.every(({ body }) => body === undefined)).toBe(true);
  });

  it('offers no way to submit or download a run that failed', async () => {
    stubApi({
      [`GET /api/console/publication-runs/${RUN}`]: {
        status: 200,
        body: { ...preparedRun, state: 'failed', outputFileId: null, errorCode: 'no_awards' },
      },
    });
    openInsight(`?view=publication-run&id=${RUN}`);

    expect(await screen.findByText('This run could not be prepared')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mark as submitted' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Download file' })).toBeNull();
  });

  it('shows nothing of publication runs without the publication permission', async () => {
    openInsight('?view=publication', ['insight.reports.read']);

    expect(await screen.findByText('You cannot open this page')).toBeTruthy();
  });

  it('refuses a missing date before sending anything', async () => {
    const sent = stubApi({});
    openInsight('?view=publication-new');
    await userEvent.click(await screen.findByRole('button', { name: 'Prepare a run' }));

    expect((await screen.findAllByText('Enter the start date.')).length).toBeGreaterThan(0);
    expect(sent).toHaveLength(0);
  });
});

describe('insight disclosure rule', () => {
  it('refuses a threshold below the platform floor before sending anything', async () => {
    const sent = stubApi({
      'GET /api/console/disclosure-rule': {
        status: 200,
        body: { version: null, threshold: 10, minimumGroup: 20, updatedAt: null },
      },
    });
    openInsight('?view=disclosure');
    await userEvent.click(await screen.findByRole('button', { name: 'Change threshold' }));
    const field = await screen.findByLabelText(/^Threshold/);
    await userEvent.clear(field);
    await userEvent.type(field, '5');
    await userEvent.click(screen.getByRole('button', { name: 'Save threshold' }));

    expect((await screen.findAllByText('Enter a threshold of 10 or more.')).length).toBeGreaterThan(
      0,
    );
    expect(sent.filter(({ key }) => key.startsWith('PUT'))).toHaveLength(0);
  });
});

describe('insight disclosure rule changes', () => {
  const rule = { version: 2, threshold: 10, minimumGroup: 20, updatedAt: now };

  it('moves focus into the form, then back and announces the save', async () => {
    stubApi({
      'GET /api/console/disclosure-rule': { status: 200, body: rule },
      'PUT /api/console/disclosure-rule': { status: 200, body: { ...rule, version: 3 } },
    });
    openInsight('?view=disclosure');
    await userEvent.click(await screen.findByRole('button', { name: 'Change threshold' }));
    expect(document.activeElement).toBe(await screen.findByLabelText(/^Threshold/));

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    const button = await screen.findByRole('button', { name: 'Change threshold' });
    await waitFor(() => {
      expect(document.activeElement).toBe(button);
    });

    await userEvent.click(button);
    await userEvent.click(await screen.findByRole('button', { name: 'Save threshold' }));
    await waitFor(() => {
      expect(screen.getAllByRole('status').map((node) => node.textContent)).toContain(
        'Threshold saved. Version 3 now applies.',
      );
    });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Change threshold' }));
  });

  it('saves once after step-up', async () => {
    let attempts = 0;
    const sent = stubApi({
      'GET /api/console/disclosure-rule': { status: 200, body: rule },
      'PUT /api/console/disclosure-rule': () => {
        attempts += 1;
        return attempts === 1
          ? problem(403, 'Confirm it is you again, then try again.')
          : { status: 200, body: { ...rule, version: 3 } };
      },
      'POST /api/auth/step-up': { status: 200, body: refreshedSession },
    });
    openInsight('?view=disclosure');
    await userEvent.click(await screen.findByRole('button', { name: 'Change threshold' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Save threshold' }));

    const dialog = await screen.findByRole('dialog', { name: 'Confirm it is you' });
    await userEvent.type(within(dialog).getByLabelText('Password'), 'correct horse battery');
    await userEvent.type(
      within(dialog).getByLabelText('Code from your authenticator app'),
      '123456',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm it is you' }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Save threshold' })).toBeNull();
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(sent.filter(({ key }) => key.startsWith('PUT'))).toHaveLength(2);
    expect(sent.filter(({ key }) => key.startsWith('POST /api/auth/step-up'))).toHaveLength(1);
  });
});

describe('insight data contracts', () => {
  it('lists each module with its version', async () => {
    stubApi({ 'GET /api/console/data-contracts': { status: 200, body: contracts } });
    openInsight('?view=contracts');

    expect(await screen.findByRole('link', { name: 'Grants' })).toBeTruthy();
    expect(screen.getByText('Not built yet')).toBeTruthy();
  });

  it("lists a module's columns with their class in words", async () => {
    stubApi({ 'GET /api/console/data-contracts': { status: 200, body: contracts } });
    openInsight('?view=contract&module=grants');

    expect(await screen.findByText('Public')).toBeTruthy();
  });
});
