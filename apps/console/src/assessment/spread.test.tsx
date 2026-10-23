// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { programme, round } from '../programme/fixtures.ts';
import { problem, stubApi } from '../testing/api.ts';
import { openConsole, setUpConsoleTests } from '../testing/render.tsx';
import {
  api,
  heading,
  ids,
  manager,
  ok,
  reviewer,
  spreadRow,
  submissionScores,
} from './fixtures.ts';

setUpConsoleTests();

const PATH = `/northfield/rounds/${ids.round}/score-spread`;

const wide = spreadRow(2, {
  organisation: { id: ids.round, name: 'Riverside Lunch Club' },
  totals: [2.4, 4.5],
  lowest: 2.4,
  highest: 4.5,
  range: 2.1,
  mean: 3.45,
});
const rows = [
  spreadRow(1, { organisation: { id: ids.round, name: 'Harbourside Youth Project' } }),
  wide,
  spreadRow(3, {
    organisation: { id: ids.round, name: 'Millbrook Allotment Society' },
    assigned: 2,
    submitted: 1,
    totals: [3.8],
    lowest: 3.8,
    highest: 3.8,
    range: 0,
    mean: 3.8,
  }),
  spreadRow(4, {
    organisation: { id: ids.round, name: 'Northfield Lunch Club' },
    submitted: 0,
    totals: [],
    lowest: null,
    highest: null,
    range: null,
    mean: null,
  }),
];

const pageReads = (found = rows) => ({
  ...manager(),
  [api.round]: ok(round),
  [api.programme]: ok(programme),
  [api.spread]: ok({ submissions: found }),
});

const bodyRows = () =>
  within(screen.getByRole('table', { name: 'Score spread for each submission' }))
    .getAllByRole('row')
    .slice(1);
const names = () => bodyRows().map((row) => within(row).getAllByRole('rowheader')[0]?.textContent);

describe('the score spread of a round', () => {
  it('shows each submission’s reviews, lowest, highest, range and mean, the widest first, and flags wide ones in words', async () => {
    stubApi(pageReads());
    openConsole(PATH);

    expect(await heading('Score spread')).toBeTruthy();
    await screen.findByRole('table', { name: 'Score spread for each submission' });
    expect(names()).toEqual([
      'Riverside Lunch Club',
      'Harbourside Youth Project',
      'Millbrook Allotment Society',
      'Northfield Lunch Club',
    ]);
    const [first, second, third, fourth] = bodyRows() as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];
    expect(first.textContent).toContain('2 of 2');
    expect(first.textContent).toContain('2.4');
    expect(first.textContent).toContain('4.5');
    expect(first.textContent).toContain('2.1');
    expect(first.textContent).toContain('3.45');
    expect(within(first).getByText('Wide spread')).toBeTruthy();
    expect(within(second).getByText('Under 1.5')).toBeTruthy();
    expect(within(third).getByText('Needs two reviews')).toBeTruthy();
    expect(within(fourth).getAllByText('None')).toHaveLength(4);
    expect(screen.getByRole('group', { name: 'Review progress' }).textContent).toContain(
      'Reviews submitted5 of 8',
    );
    const breadcrumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(breadcrumbs).getByText('Autumn 2026')).toBeTruthy();
  });

  it('sorts by a column, and shows only the wide spreads on request', async () => {
    const user = userEvent.setup();
    stubApi(pageReads());
    openConsole(PATH);
    await screen.findByRole('table', { name: 'Score spread for each submission' });

    await user.click(screen.getByRole('button', { name: 'Organisation' }));
    expect(names()).toEqual([
      'Harbourside Youth Project',
      'Millbrook Allotment Society',
      'Northfield Lunch Club',
      'Riverside Lunch Club',
    ]);
    await user.click(screen.getByRole('button', { name: 'Mean' }));
    await user.click(screen.getByRole('button', { name: 'Mean' }));
    expect(names()[0]).toBe('Millbrook Allotment Society');

    await user.click(screen.getByRole('button', { name: /^Wide spread/ }));
    expect(names()).toEqual(['Riverside Lunch Club']);
    expect(screen.getByRole('button', { name: /^Wide spread/ }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('shows how each reviewer scored each criterion, in a dialog that returns focus', async () => {
    const user = userEvent.setup();
    const sent = stubApi({
      ...pageReads(),
      [api.scores(wide.submissionId)]: ok(submissionScores),
    });
    openConsole(PATH);
    await screen.findByRole('table', { name: 'Score spread for each submission' });

    const button = within(bodyRows()[0] as HTMLElement).getByRole('button', {
      name: /Show scores/,
    });
    await user.click(button);

    const dialog = await screen.findByRole('dialog', { name: 'Scores for Riverside Lunch Club' });
    const table = await within(dialog).findByRole('table');
    const lines = within(table).getAllByRole('row');
    expect(lines.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Reviewer'),
      'Priya Shah5444.5',
      'Tom Okafor2332.4',
      expect.stringContaining('Gap between highest and lowest'),
    ]);
    expect(lines[3]?.textContent).toContain('Widest gap');
    expect(lines[3]?.textContent).toContain('2.1');
    expect(sent.some(({ key }) => key === api.scores(wide.submissionId))).toBe(true);

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(document.activeElement).toBe(button);
    });
  });

  it('opens the scores from Enter on a row, and lists the keys', async () => {
    const user = userEvent.setup();
    stubApi({ ...pageReads(), [api.scores(wide.submissionId)]: ok(submissionScores) });
    openConsole(PATH);
    await screen.findByRole('table', { name: 'Score spread for each submission' });

    (bodyRows()[0] as HTMLElement).focus();
    await user.keyboard('?');
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
    await user.keyboard('{Escape}');
    await user.keyboard('{Enter}');
    expect(
      await screen.findByRole('dialog', { name: 'Scores for Riverside Lunch Club' }),
    ).toBeTruthy();
  });

  it('tells a manager with no reviewers assigned what to do next', async () => {
    stubApi(pageReads([]));
    openConsole(PATH);

    expect(
      await screen.findByRole('heading', { level: 2, name: 'No reviewers are assigned yet' }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to submissions' }).getAttribute('href')).toBe(
      `/northfield/submissions?roundId=${ids.round}`,
    );
  });

  it('says why it did not load and offers another go', async () => {
    const user = userEvent.setup();
    let reads = 0;
    stubApi({
      ...pageReads(),
      [api.spread]: () => {
        reads += 1;
        return reads === 1
          ? problem(503, 'The service is busy. Try again in a minute.')
          : ok({ submissions: rows });
      },
    });
    openConsole(PATH);

    expect(await screen.findByText('The service is busy. Try again in a minute.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('table', { name: 'Score spread for each submission' }),
    ).toBeTruthy();
  });

  it('is for someone who can assign reviewers, and never for a reviewer', async () => {
    stubApi({ ...reviewer() });
    openConsole(PATH);

    expect(await heading('Score spread')).toBeTruthy();
    expect(
      screen.getByRole('heading', { level: 2, name: 'You cannot manage reviewers' }),
    ).toBeTruthy();
  });
});
