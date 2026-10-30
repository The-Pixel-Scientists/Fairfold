// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { consoleSession, problem } from '../testing/api.ts';
import { stubApi } from '../testing/api.ts';
import { containing } from '../testing/names.ts';
import { expectTitle, openConsole, setUpConsoleTests } from '../testing/render.tsx';
import { SESSION } from '../programme/fixtures.ts';
import {
  api,
  heading,
  ids,
  listReads,
  manager,
  ok,
  page,
  programme,
  programmes,
  rowsOfTable,
  summary,
} from './fixtures.ts';

setUpConsoleTests();

const PATH = '/northfield/submissions';

const rowFor = (name: string) =>
  screen.getByRole('rowheader', { name: containing(name) }).closest('tr') as HTMLElement;

describe('the submissions list', () => {
  it('shows each submission with its round, stage, date, late tag, eligibility, status and next step', async () => {
    const first = summary(1);
    const second = summary(2, { late: true, eligibility: 'stopped' });
    const third = summary(3, {
      status: 'withdrawn',
      eligibility: null,
      submittedAt: '2026-10-05T12:00:00.000Z',
    });
    stubApi(listReads([first, second, third]));
    openConsole(PATH);

    await heading('Submissions');
    await screen.findByRole('table', { name: 'Submissions' });

    const harbourside = within(rowFor('Harbourside'));
    expect(
      harbourside.getByRole('link', { name: 'Harbourside Youth Project' }).getAttribute('href'),
    ).toBe(`/northfield/submissions/${first.id}`);
    expect(harbourside.getByText('Community Spaces Fund')).toBeTruthy();
    expect(harbourside.getByText('Autumn 2026')).toBeTruthy();
    expect(harbourside.getByText('Intake')).toBeTruthy();
    expect(harbourside.getByText('Eligible')).toBeTruthy();
    expect(harbourside.getByText('Submitted')).toBeTruthy();
    expect(harbourside.getByText('Ready to move on')).toBeTruthy();
    expect(harbourside.queryByText('Late')).toBeNull();

    const millbrook = within(rowFor('Millbrook'));
    expect(millbrook.getByText('Late')).toBeTruthy();
    expect(millbrook.getByText('Not eligible')).toBeTruthy();
    expect(millbrook.getByText('Check why it is not eligible')).toBeTruthy();

    const lunch = within(rowFor('Northfield Lunch Club'));
    expect(lunch.getByText('5 October 2026')).toBeTruthy();
    expect(lunch.getByText('Not checked')).toBeTruthy();
    expect(lunch.getByText('Withdrawn')).toBeTruthy();
    expect(lunch.getByText('Nothing: the applicant withdrew it')).toBeTruthy();
    expect(screen.getByText('3 submissions')).toBeTruthy();
    await expectTitle('Submissions – Fairfold Grants console');
  });

  it('is in the navigation for someone who can read submissions', async () => {
    stubApi(listReads([summary(1)]));
    openConsole(PATH);
    await heading('Submissions');

    const link = within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', {
      name: 'Submissions',
    });
    expect(link.getAttribute('href')).toBe(PATH);
    expect(link.getAttribute('aria-current')).toBe('page');
  });

  it('puts a filter in the address, asks the API for it, and shows it chosen', async () => {
    const user = userEvent.setup();
    stubApi({
      ...listReads([summary(1), summary(2)]),
      [api.list('?status=withdrawn')]: ok(page([summary(3, { status: 'withdrawn' })])),
    });
    openConsole(PATH);
    await screen.findByRole('table', { name: 'Submissions' });

    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'Withdrawn');

    await waitFor(() => {
      expect(rowsOfTable()).toHaveLength(1);
    });
    expect(window.location.search).toBe('?status=withdrawn');
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Status' }).value).toBe(
      'withdrawn',
    );
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeTruthy();
  });

  it('reads the filters from the address, so a bookmark or a shared link shows the same list', async () => {
    const search = `?roundId=${ids.round}&stageId=${ids.review}&status=submitted&eligibility=stopped&late=true`;
    const sent = stubApi({
      ...listReads([], search),
    });
    openConsole(`${PATH}${search}`);

    expect(
      await screen.findByRole('heading', { level: 2, name: 'No submissions match these filters' }),
    ).toBeTruthy();
    expect(sent.map(({ key }) => key)).toContain(api.list(search));
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Round' }).value).toBe(
      ids.round,
    );
    await waitFor(() => {
      expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Stage' }).value).toBe(
        ids.review,
      );
    });
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Eligibility' }).value).toBe(
      'stopped',
    );
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Late' }).value).toBe('true');
  });

  it('offers a round only for the chosen programme, and the stages of the chosen round', async () => {
    const user = userEvent.setup();
    const other = { ...ids, programme: '99999999-8888-4777-8666-555555555555' };
    stubApi({
      ...listReads([summary(1)]),
      [api.programmes]: ok({
        programmes: [
          ...programmes.programmes,
          { ...programme, id: other.programme, title: 'Youth Futures', rounds: [] },
        ],
      }),
      [api.list(`?roundId=${ids.round}`)]: ok(page([summary(1)])),
      [api.list(`?programmeId=${other.programme}`)]: ok(page([])),
    });
    openConsole(PATH);
    await screen.findByRole('table', { name: 'Submissions' });
    const stage = () => screen.getByRole<HTMLSelectElement>('combobox', { name: 'Stage' });
    expect(stage().disabled).toBe(true);
    expect(within(stage()).getByRole('option', { name: 'Pick a round' })).toBeTruthy();

    await screen.findByRole('option', { name: 'Autumn 2026' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Round' }), 'Autumn 2026');
    await waitFor(() => {
      expect(stage().disabled).toBe(false);
    });
    expect(
      within(stage())
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Any', 'Intake', 'Review', 'Decision']);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Programme' }), 'Youth Futures');
    await waitFor(() => {
      expect(window.location.search).toBe(`?programmeId=${other.programme}`);
    });
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Round' }).value).toBe('');
  });

  it('brings the earlier filters back with Back', async () => {
    const user = userEvent.setup();
    stubApi({
      ...listReads([summary(1), summary(2)]),
      [api.list('?status=withdrawn')]: ok(page([summary(3, { status: 'withdrawn' })])),
    });
    openConsole(PATH);
    await screen.findByRole('table', { name: 'Submissions' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'Withdrawn');
    await waitFor(() => {
      expect(rowsOfTable()).toHaveLength(1);
    });

    window.history.back();

    await waitFor(() => {
      expect(rowsOfTable()).toHaveLength(2);
    });
    expect(window.location.search).toBe('');
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Status' }).value).toBe('');
  });

  it('clears every filter in one step and goes back to the whole list', async () => {
    const user = userEvent.setup();
    stubApi({
      ...listReads([summary(1)]),
      [api.list('?late=true')]: ok(page([])),
    });
    openConsole(`${PATH}?late=true`);
    await screen.findByRole('heading', { level: 2, name: 'No submissions match these filters' });
    expect(
      screen.getByText(/Every filter narrows the list, so a submission has to match all of them/),
    ).toBeTruthy();

    await user.click(screen.getAllByRole('button', { name: 'Clear filters' })[0] as HTMLElement);

    await screen.findByRole('table', { name: 'Submissions' });
    expect(window.location.search).toBe('');
  });

  it('says what to do when there are no submissions at all', async () => {
    stubApi(listReads([]));
    openConsole(PATH);

    expect(
      await screen.findByRole('heading', { level: 2, name: 'No submissions yet' }),
    ).toBeTruthy();
    expect(screen.getByText(/Submissions appear here as soon as applicants send in/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to programmes' }).getAttribute('href')).toBe(
      '/northfield/',
    );
  });

  it('shows that it is loading, then why it failed and a way to try again', async () => {
    const user = userEvent.setup();
    let reads = 0;
    stubApi({
      ...listReads([summary(1)]),
      [api.list()]: () => {
        reads += 1;
        return reads === 1
          ? problem(503, 'The service is busy. Try again in a minute.')
          : ok(page([summary(1)]));
      },
    });
    openConsole(PATH);

    expect(await screen.findByText('We could not load submissions')).toBeTruthy();
    expect(screen.getByText('The service is busy. Try again in a minute.')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Submissions' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('table', { name: 'Submissions' })).toBeTruthy();
  });

  it('refuses an address with a filter that does not exist, and links to the whole list', async () => {
    const sent = stubApi({ ...manager() });
    openConsole(`${PATH}?status=bogus`);

    expect(
      await screen.findByRole('heading', { level: 2, name: 'These filters are not valid' }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Show every submission' }).getAttribute('href')).toBe(
      PATH,
    );
    expect(sent.map(({ key }) => key)).toEqual([SESSION]);
  });

  it('tells a person without the permission so, and asks the API for nothing', async () => {
    const sent = stubApi({ [SESSION]: ok(consoleSession({ roles: ['reviewer'] })) });
    openConsole(PATH);

    expect(
      await screen.findByRole('heading', { level: 2, name: 'You cannot view submissions' }),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Submissions' })).toBeTruthy();
    expect(sent.map(({ key }) => key)).toEqual([SESSION]);
  });

  it('turns to the next page from a link in the address, and back to the first', async () => {
    const user = userEvent.setup();
    stubApi({
      ...manager(),
      [api.programmes]: ok({ programmes: [] }),
      [api.list()]: ok(page([summary(1)], { total: 2, nextCursor: 'abc_1' })),
      [api.list('?cursor=abc_1')]: ok(page([summary(2)], { total: 2 })),
    });
    openConsole(PATH);
    await screen.findByRole('table', { name: 'Submissions' });
    // A page kept from an earlier visit shows at once, and the fresh answer replaces it.
    expect(await screen.findByText('Showing 1 on this page, 2 submissions in all')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Back to the first page' })).toBeNull();

    const next = screen.getByRole('link', { name: 'Next page' });
    expect(next.getAttribute('href')).toBe(`${PATH}?cursor=abc_1`);
    await user.click(next);

    await screen.findByRole('rowheader', { name: containing('Millbrook') });
    expect(window.location.search).toBe('?cursor=abc_1');
    expect(screen.queryByRole('link', { name: 'Next page' })).toBeNull();
    await waitFor(() => {
      expect(document.activeElement?.textContent).toContain('on this page');
    });

    await user.click(screen.getByRole('link', { name: 'Back to the first page' }));
    await screen.findByRole('rowheader', { name: containing('Harbourside') });
    expect(window.location.search).toBe('');
  });

  it('carries the filters and page in each submission link, so the detail page can come back', async () => {
    stubApi({
      ...manager(),
      [api.programmes]: ok({ programmes: [] }),
      [api.list('?status=submitted&cursor=abc_1')]: ok(page([summary(1)])),
    });
    openConsole(`${PATH}?status=submitted&cursor=abc_1`);

    const link = await screen.findByRole('link', { name: 'Harbourside Youth Project' });
    expect(link.getAttribute('href')).toBe(
      `/northfield/submissions/${summary(1).id}?status=submitted&cursor=abc_1`,
    );
  });
});
