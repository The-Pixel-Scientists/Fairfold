// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ok } from '../programme/fixtures.ts';
import { consoleSession, problem, stubApi } from '../testing/api.ts';
import { openConsole, setUpConsoleTests } from '../testing/render.tsx';

setUpConsoleTests();

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const FRAMEWORK = uuid(1);
const OUTCOME = uuid(2);
const WALKS = uuid(3);
const SPEND = uuid(4);
const stamp = '2026-11-01T09:00:00.000Z';

const framework = {
  id: FRAMEWORK,
  name: 'Wellbeing',
  description: 'What our grants change for older people.',
  outcomes: { [OUTCOME]: { name: 'Less isolation', description: '' } },
  indicators: {
    [WALKS]: {
      outcomeId: OUTCOME,
      name: 'Walks led',
      unit: 'count',
      direction: 'increase',
      aggregation: 'sum',
    },
    [SPEND]: {
      outcomeId: OUTCOME,
      name: 'Cost per walk',
      unit: 'money',
      direction: 'decrease',
      aggregation: 'average',
    },
  },
  version: 2,
  archivedAt: null,
  createdAt: stamp,
  updatedAt: stamp,
};

const target = {
  id: uuid(10),
  frameworkId: FRAMEWORK,
  indicatorId: WALKS,
  programmeId: null,
  periodStart: '2026-04-01',
  periodEnd: '2027-03-31',
  baseline: null,
  target: 120,
  createdAt: stamp,
  updatedAt: stamp,
};

const result = {
  id: uuid(20),
  frameworkId: FRAMEWORK,
  indicatorId: WALKS,
  programmeId: null,
  periodStart: '2026-04-01',
  periodEnd: '2026-06-30',
  value: 30,
  source: 'manual',
  recordedAt: stamp,
  updatedAt: stamp,
  evidenceCount: 1,
};

const note = {
  id: uuid(30),
  frameworkId: FRAMEWORK,
  outcomeId: OUTCOME,
  text: 'Walks in the rain drew fewer people.',
  createdAt: stamp,
};

const api = {
  list: 'GET /console/outcome-frameworks',
  read: `GET /console/outcome-frameworks/${FRAMEWORK}`,
  summary: `GET /console/outcome-frameworks/${FRAMEWORK}/summary`,
  targets: `GET /console/outcome-frameworks/${FRAMEWORK}/targets`,
  notes: `GET /console/outcome-frameworks/${FRAMEWORK}/learning-notes`,
  results: `GET /console/indicator-results?frameworkId=${FRAMEWORK}`,
  createFramework: 'POST /console/outcome-frameworks',
  createTarget: 'POST /console/indicator-targets',
  createResult: 'POST /console/indicator-results',
  removeNote: `DELETE /console/learning-notes/${note.id}`,
};

const summary = {
  frameworkId: FRAMEWORK,
  version: 2,
  indicators: [
    {
      indicatorId: WALKS,
      value: 30,
      resultCount: 1,
      latestPeriodEnd: '2026-06-30',
      target: 120,
      baseline: null,
    },
    {
      indicatorId: SPEND,
      value: null,
      resultCount: 0,
      latestPeriodEnd: null,
      target: null,
      baseline: null,
    },
  ],
};

const session = (roles: Parameters<typeof consoleSession>[0] = {}) => ({
  'GET /auth/session': ok(consoleSession({ modules: ['grants', 'impact'], ...roles })),
});

const pageReads = () => ({
  [api.read]: ok(framework),
  [api.summary]: ok(summary),
  [api.targets]: ok({ targets: [target] }),
  [api.notes]: ok({ notes: [note] }),
  [api.results]: ok({ results: [result], nextCursor: null }),
});

const page = `/northfield/impact/${FRAMEWORK}`;
const heading = (name: string) => screen.findByRole('heading', { level: 1, name });

describe('the frameworks list', () => {
  it('lists each framework with its status and a way to make one', async () => {
    stubApi({
      ...session(),
      [api.list]: ok({
        frameworks: [
          {
            id: FRAMEWORK,
            name: 'Wellbeing',
            description: '',
            outcomeCount: 1,
            indicatorCount: 2,
            version: 2,
            archivedAt: null,
            updatedAt: stamp,
          },
          {
            id: uuid(5),
            name: 'Older work',
            description: '',
            outcomeCount: 2,
            indicatorCount: 0,
            version: 1,
            archivedAt: stamp,
            updatedAt: stamp,
          },
        ],
      }),
    });
    openConsole('/northfield/impact');

    expect(await heading('Impact')).toBeTruthy();
    const table = await screen.findByRole('table', { name: 'Outcomes frameworks' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]?.textContent).toContain('Wellbeing');
    expect(rows[0]?.textContent).toContain('Active');
    expect(rows[1]?.textContent).toContain('Older work');
    expect(rows[1]?.textContent).toContain('Archived');
    expect(screen.getByRole('link', { name: 'New framework' }).getAttribute('href')).toBe(
      '/northfield/impact/new',
    );
  });

  it('says what to do next when there are none, and hides the controls from a reader', async () => {
    stubApi({ ...session({ roles: ['analyst'] }), [api.list]: ok({ frameworks: [] }) });
    openConsole('/northfield/impact');

    expect(await screen.findByText('No outcomes frameworks yet')).toBeTruthy();
    expect(screen.getByText(/Ask someone who can set up outcomes/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /framework/i })).toBeNull();
  });

  it('says so, with a way to try again, when the list does not load', async () => {
    stubApi({ ...session(), [api.list]: problem(500, 'The server could not read frameworks.') });
    openConsole('/northfield/impact');

    expect(await screen.findByText('The server could not read frameworks.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

describe('a framework', () => {
  it('shows progress, targets, results and learning notes', async () => {
    stubApi({ ...session(), ...pageReads() });
    openConsole(page);

    expect(await heading('Wellbeing')).toBeTruthy();
    const progress = await screen.findByRole('table', { name: 'Progress by indicator' });
    const walks = within(progress).getByRole('row', { name: /Walks led/ }).textContent;
    expect(walks).toContain('120');
    expect(walks).toContain('25% of the way');
    expect(within(progress).getByRole('row', { name: /Cost per walk/ }).textContent).toContain(
      'No target set',
    );
    expect(await screen.findByRole('table', { name: 'Targets' })).toBeTruthy();
    expect(await screen.findByRole('table', { name: 'Results' })).toBeTruthy();
    expect(screen.getByText('Walks in the rain drew fewer people.')).toBeTruthy();
  });

  it('sets a target and reads the page again', async () => {
    const user = userEvent.setup();
    const sent = stubApi({
      ...session(),
      ...pageReads(),
      [api.createTarget]: { status: 201, body: { ...target, id: uuid(11) } },
    });
    openConsole(page);

    await user.click(await screen.findByRole('button', { name: 'Set a target' }));
    const dialog = await screen.findByRole('dialog', { name: 'Set a target' });
    await user.click(within(dialog).getByRole('button', { name: 'Set target' }));
    expect(await within(dialog).findAllByText('Choose an indicator.')).not.toHaveLength(0);

    await user.selectOptions(within(dialog).getByLabelText('Indicator'), WALKS);
    await user.type(within(dialog).getByLabelText('Period starts'), '2026-04-01');
    await user.type(within(dialog).getByLabelText('Period ends'), '2027-03-31');
    await user.type(within(dialog).getByLabelText('Target'), '120');
    await user.click(within(dialog).getByRole('button', { name: 'Set target' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(sent.find(({ key }) => key === api.createTarget)?.body).toEqual({
      frameworkId: FRAMEWORK,
      indicatorId: WALKS,
      programmeId: null,
      periodStart: '2026-04-01',
      periodEnd: '2027-03-31',
      baseline: null,
      target: 120,
    });
  });

  it('records a result for money in pounds as pence', async () => {
    const user = userEvent.setup();
    const sent = stubApi({
      ...session(),
      ...pageReads(),
      [api.createResult]: {
        status: 201,
        body: { ...result, id: uuid(21), note: '', evidence: [] },
      },
    });
    openConsole(page);

    await user.click(await screen.findByRole('button', { name: 'Record a result' }));
    const dialog = await screen.findByRole('dialog', { name: 'Record a result' });
    await user.selectOptions(within(dialog).getByLabelText('Indicator'), SPEND);
    await user.type(within(dialog).getByLabelText('Period starts'), '2026-04-01');
    await user.type(within(dialog).getByLabelText('Period ends'), '2026-06-30');
    await user.type(within(dialog).getByLabelText('Result (£)'), '12.50');
    await user.click(within(dialog).getByRole('button', { name: 'Record result' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(sent.find(({ key }) => key === api.createResult)?.body).toMatchObject({
      indicatorId: SPEND,
      value: 1250,
      evidence: [],
    });
  });

  it('shows what the server refused beside the field and in the summary', async () => {
    const user = userEvent.setup();
    stubApi({
      ...session(),
      ...pageReads(),
      [api.createResult]: problem(409, 'Refused.', [
        { field: 'body.value', message: "This figure doesn't fit the indicator's unit." },
      ]),
    });
    openConsole(page);

    await user.click(await screen.findByRole('button', { name: 'Record a result' }));
    const dialog = await screen.findByRole('dialog', { name: 'Record a result' });
    await user.selectOptions(within(dialog).getByLabelText('Indicator'), WALKS);
    await user.type(within(dialog).getByLabelText('Period starts'), '2026-07-01');
    await user.type(within(dialog).getByLabelText('Period ends'), '2026-09-30');
    await user.type(within(dialog).getByLabelText('Result'), '5');
    await user.click(within(dialog).getByRole('button', { name: 'Record result' }));

    const summary = await within(dialog).findByRole('alert');
    expect(within(summary).getByText("This figure doesn't fit the indicator's unit.")).toBeTruthy();
    expect(document.activeElement).toBe(summary);
    expect(
      within(dialog).getAllByText("This figure doesn't fit the indicator's unit."),
    ).toHaveLength(2);
  });

  it('asks before removing a learning note, then removes it', async () => {
    const user = userEvent.setup();
    let removed = false;
    const sent = stubApi({
      ...session(),
      ...pageReads(),
      [api.notes]: () => ok({ notes: removed ? [] : [note] }),
      [api.removeNote]: () => {
        removed = true;
        return { status: 204 };
      },
    });
    openConsole(page);

    await user.click(
      await screen.findByRole('button', { name: /Remove note from 1 November 2026/ }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Remove this learning note?' });
    await user.click(within(dialog).getByRole('button', { name: 'Remove note' }));

    expect(await screen.findByText('No learning notes yet')).toBeTruthy();
    expect(sent.some(({ key }) => key === api.removeNote)).toBe(true);
  });

  it('gives a reader no controls to change anything', async () => {
    stubApi({ ...session({ roles: ['analyst'] }), ...pageReads() });
    openConsole(page);

    expect(await heading('Wellbeing')).toBeTruthy();
    await screen.findByRole('table', { name: 'Results' });
    for (const name of [/Edit framework/, /Archive framework/, /Set a target/, /Record a result/]) {
      expect(screen.queryByRole('button', { name })).toBeNull();
      expect(screen.queryByRole('link', { name })).toBeNull();
    }
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
  });

  it('takes no changes once archived', async () => {
    stubApi({
      ...session(),
      ...pageReads(),
      [api.read]: ok({ ...framework, archivedAt: stamp }),
    });
    openConsole(page);

    expect(await screen.findByText('This framework is archived')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Set a target' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Record a result' })).toBeNull();
  });
});

describe('making a framework', () => {
  it('says what to fix next to the box and in the summary, and moves focus to the summary', async () => {
    const user = userEvent.setup();
    stubApi({ ...session() });
    openConsole('/northfield/impact/new');

    await user.click(await screen.findByRole('button', { name: 'Create framework' }));

    const summary = await screen.findByRole('alert');
    expect(within(summary).getByText('Enter a name for the framework.')).toBeTruthy();
    expect(within(summary).getByText('Enter a name for the outcome.')).toBeTruthy();
    expect(document.activeElement).toBe(summary);
    expect(screen.getAllByText('Enter a name for the framework.')).toHaveLength(2);
  });

  it('sends the outcomes and indicators by their ids and opens the framework', async () => {
    const user = userEvent.setup();
    const sent = stubApi({
      ...session(),
      [api.createFramework]: { status: 201, body: framework },
      ...pageReads(),
    });
    openConsole('/northfield/impact/new');

    await user.type(await screen.findByLabelText('Name'), 'Wellbeing');
    await user.type(screen.getByLabelText('Outcome 1 name'), 'Less isolation');
    await user.click(screen.getByRole('button', { name: 'Add an indicator to outcome 1' }));
    await user.type(await screen.findByLabelText('Indicator 1.1 name'), 'Walks led');
    await user.click(screen.getByRole('button', { name: 'Create framework' }));

    expect(await heading('Wellbeing')).toBeTruthy();
    const body = sent.find(({ key }) => key === api.createFramework)?.body as {
      name: string;
      outcomes: Record<string, { name: string }>;
      indicators: Record<string, { outcomeId: string; name: string; unit: string }>;
    };
    const [outcomeId] = Object.keys(body.outcomes);
    expect(body.name).toBe('Wellbeing');
    expect(Object.values(body.indicators)).toEqual([
      {
        outcomeId,
        name: 'Walks led',
        unit: 'count',
        direction: 'increase',
        aggregation: 'sum',
      },
    ]);
  });
});
