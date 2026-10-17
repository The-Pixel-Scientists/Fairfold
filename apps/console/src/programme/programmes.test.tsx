// SPDX-License-Identifier: AGPL-3.0-or-later

import { messages } from '@pixel-scientists/domain/platform';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { consoleSession, problem, signedOut, stubApi } from '../testing/api.ts';
import { titleSuffix } from '../product.ts';
import { expectTitle, openConsole, setUpConsoleTests } from '../testing/render.tsx';
import { SESSION, api, heading, ids, manager, ok, pounds, programme, round } from './fixtures.ts';

setUpConsoleTests();

const summer = {
  ...round,
  id: '11111111-2222-4333-8444-555555555555',
  title: 'Summer 2026',
  opensAt: '2026-04-01T09:00',
  closesAt: '2026-05-01T17:00',
  budget: pounds(40_000),
};

const second = {
  id: '99999999-8888-4777-8666-555555555555',
  title: 'Youth Futures',
  summary: 'Support for young people.',
  status: 'open',
  rounds: [],
};

const list = {
  programmes: [
    {
      id: programme.id,
      title: programme.title,
      summary: programme.summary,
      status: 'draft',
      rounds: [summer, round],
    },
    second,
  ],
};

const rowFor = (name: string) =>
  screen.getByRole('rowheader', { name: new RegExp(name) }).closest('tr') as HTMLElement;

describe('the programmes page', () => {
  it('lists each programme with its status and the round it opened last', async () => {
    stubApi({ ...manager(), [api.programmes]: ok(list) });
    openConsole('/northfield/');

    await heading('Programmes');

    const table = await screen.findByRole('table', { name: 'Programmes' });
    const fund = within(rowFor('Community Spaces Fund'));
    expect(fund.getByRole('link', { name: 'Community Spaces Fund' }).getAttribute('href')).toBe(
      `/northfield/programmes/${programme.id}`,
    );
    expect(fund.getByText('Grants for places where neighbours meet.')).toBeTruthy();
    expect(fund.getByText('Draft')).toBeTruthy();
    expect(fund.getByRole('link', { name: 'Autumn 2026' }).getAttribute('href')).toBe(
      `/northfield/rounds/${round.id}`,
    );
    expect(fund.getByText('2 November 2026')).toBeTruthy();
    expect(fund.getByText('£150,000')).toBeTruthy();
    const youth = within(rowFor('Youth Futures'));
    expect(youth.getByText('Open')).toBeTruthy();
    expect(youth.getByText('No rounds yet')).toBeTruthy();
    expect(within(table).getAllByText('None')).toHaveLength(2);
    await expectTitle(`Programmes – ${titleSuffix}`);
  });

  it('sorts by a column from its heading, and says which way', async () => {
    const user = userEvent.setup();
    stubApi({ ...manager(), [api.programmes]: ok(list) });
    openConsole('/northfield/');
    await screen.findByRole('table', { name: 'Programmes' });

    const titles = () =>
      screen
        .getAllByRole('rowheader')
        .map((cell) => within(cell).getAllByRole('link')[0]?.textContent);
    expect(titles()).toEqual(['Community Spaces Fund', 'Youth Futures']);
    expect(screen.getByRole('columnheader', { name: 'Programme' }).getAttribute('aria-sort')).toBe(
      'ascending',
    );

    await user.click(screen.getByRole('button', { name: 'Programme' }));
    expect(titles()).toEqual(['Youth Futures', 'Community Spaces Fund']);
    expect(screen.getByRole('columnheader', { name: 'Programme' }).getAttribute('aria-sort')).toBe(
      'descending',
    );

    await user.click(screen.getByRole('button', { name: 'Budget' }));
    expect(titles()).toEqual(['Youth Futures', 'Community Spaces Fund']);
    await user.click(screen.getByRole('button', { name: 'Budget' }));
    expect(titles()).toEqual(['Community Spaces Fund', 'Youth Futures']);
  });

  it('offers a way to start a programme from the header and from the empty list', async () => {
    stubApi({ ...manager(), [api.programmes]: ok({ programmes: [] }) });
    openConsole('/northfield/');

    expect(
      await screen.findByRole('heading', { level: 2, name: 'No programmes yet' }),
    ).toBeTruthy();
    expect(screen.getByText(/A programme is one grant you run/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'New programme' }).getAttribute('href')).toBe(
      '/northfield/programmes/new',
    );
    expect(screen.getByRole('link', { name: 'Create a programme' }).getAttribute('href')).toBe(
      '/northfield/programmes/new',
    );
  });

  it('shows that it is loading, then the words for a failure and a way to try again', async () => {
    const user = userEvent.setup();
    let reads = 0;
    stubApi({
      ...manager(),
      [api.programmes]: () => {
        reads += 1;
        return reads === 1 ? problem(503, 'The service is busy. Try again in a minute.') : ok(list);
      },
    });
    openConsole('/northfield/');

    expect(await screen.findByText('We could not load this page')).toBeTruthy();
    expect(screen.getByText('The service is busy. Try again in a minute.')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Programmes' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('table', { name: 'Programmes' })).toBeTruthy();
  });

  it('tells a person without the permission so, and asks the API for nothing', async () => {
    const sent = stubApi({ [SESSION]: ok(consoleSession({ roles: ['reviewer'] })) });
    openConsole('/northfield/');

    expect(
      await screen.findByRole('heading', { level: 2, name: 'You cannot set up programmes' }),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Programmes' })).toBeTruthy();
    expect(sent.map(({ key }) => key)).toEqual([SESSION]);
  });

  it('sends a visitor who is not signed in to sign in, and back afterwards', async () => {
    stubApi({ [SESSION]: signedOut });
    openConsole(`/northfield/rounds/${ids.round}`);

    await heading('Sign in');

    expect(window.location.pathname).toBe('/northfield/sign-in');
    expect(window.location.search).toBe(`?next=%2Frounds%2F${ids.round}`);
  });

  it('shows page not found for an address that is not a real id', async () => {
    stubApi({ ...manager() });
    openConsole('/northfield/rounds/spring');

    await heading('Page not found');
  });

  it('keeps the failure words out of the page when the API sends something unexpected', async () => {
    stubApi({ ...manager(), [api.programmes]: ok({ programmes: 'none' }) });
    openConsole('/northfield/');

    expect(await screen.findByText(messages.serviceFailed)).toBeTruthy();
  });
});
