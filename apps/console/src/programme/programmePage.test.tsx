// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { titleSuffix } from '../product.ts';
import { problem, stubApi } from '../testing/api.ts';
import { expectTitle, openConsole, setUpConsoleTests } from '../testing/render.tsx';
import { api, heading, history, manager, ok, programme, reads, round, nth } from './fixtures.ts';

setUpConsoleTests();

const open = () => {
  openConsole(`/northfield/programmes/${programme.id}`);
  return heading('Community Spaces Fund');
};

describe('a programme page', () => {
  it('shows what the programme is, its rounds and its emails, with the ways to change them', async () => {
    stubApi({ ...manager(), ...reads });
    await open();

    await expectTitle(`Programme – ${titleSuffix}`);
    expect(screen.getByText('Grants for places where neighbours meet.')).toBeTruthy();
    expect(screen.getByText('Draft')).toBeTruthy();
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'Programmes' }).getAttribute('href')).toBe(
      '/northfield/',
    );
    expect(screen.getByRole('link', { name: 'Edit programme' }).getAttribute('href')).toBe(
      `/northfield/programmes/${programme.id}/edit`,
    );
    expect(screen.getByRole('link', { name: 'New round' }).getAttribute('href')).toBe(
      `/northfield/programmes/${programme.id}/rounds/new`,
    );
    expect(await screen.findByText(/Funds repairs, equipment and running costs/)).toBeTruthy();

    const rounds = await screen.findByRole('table', { name: 'Rounds' });
    const row = within(nth(within(rounds).getAllByRole('row'), 1));
    expect(row.getByRole('link', { name: 'Autumn 2026' }).getAttribute('href')).toBe(
      `/northfield/rounds/${round.id}`,
    );
    expect(row.getByText('12 October 2026')).toBeTruthy();
    expect(row.getByText('2 November 2026')).toBeTruthy();
    expect(row.getByText('£150,000')).toBeTruthy();
    expect(row.getByText('£5,000 to £25,000')).toBeTruthy();

    const emails = await screen.findByRole('table', { name: 'Outcome emails' });
    expect(within(emails).getByRole('rowheader', { name: 'Accepted' })).toBeTruthy();
    expect(
      within(emails).getByText('{{programme_title}}: we are offering you a grant'),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Edit emails' }).getAttribute('href')).toBe(
      `/northfield/programmes/${programme.id}/emails`,
    );
  });

  it('says what to do next when there are no rounds', async () => {
    stubApi({ ...manager(), ...reads, [api.rounds]: ok({ rounds: [] }) });
    await open();

    expect(await screen.findByRole('heading', { level: 3, name: 'No rounds yet' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Add a round' }).getAttribute('href')).toBe(
      `/northfield/programmes/${programme.id}/rounds/new`,
    );
  });

  it('shows a description that is empty as not written yet', async () => {
    stubApi({ ...manager(), ...reads, [api.programme]: ok({ ...programme, description: '' }) });
    await open();

    expect(await screen.findByText('No description yet.')).toBeTruthy();
  });

  it('keeps working when one part cannot be read: each part says so and offers to try again', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    stubApi({
      ...manager(),
      ...reads,
      [api.rounds]: () => {
        attempts += 1;
        return attempts === 1
          ? problem(503, 'The service is busy. Try again in a minute.')
          : ok({ rounds: [round] });
      },
    });
    await open();

    expect(await screen.findByText('The service is busy. Try again in a minute.')).toBeTruthy();
    expect(await screen.findByRole('table', { name: 'Outcome emails' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Configuration history' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('table', { name: 'Rounds' })).toBeTruthy();
  });

  it('keeps the title in place while the programme loads, and asks the API only for what the person may read', async () => {
    const sent = stubApi({ ...manager(), ...reads });
    openConsole(`/northfield/programmes/${programme.id}`);

    expect(await screen.findByRole('heading', { level: 1, name: 'Programme' })).toBeTruthy();
    await heading('Community Spaces Fund');
    expect(new Set(sent.map(({ key }) => key))).toEqual(
      new Set(['GET /auth/session', api.programme, api.rounds, api.emails, api.programmeHistory]),
    );
  });
});

describe('the configuration history', () => {
  it('says who changed what and when, with the old and new values in words', async () => {
    const user = userEvent.setup();
    stubApi({ ...manager(), ...reads });
    await open();

    const panel = await screen.findByRole('region', { name: 'Configuration history' });
    const entries = await within(panel).findAllByRole('listitem');
    expect(entries).toHaveLength(2);
    expect(within(nth(entries, 0)).getByText('Changed closing date and time')).toBeTruthy();
    expect(nth(entries, 0).textContent).toContain('Ada Reed, 13 October 2026 at');
    expect(within(nth(entries, 1)).getByText('Created')).toBeTruthy();
    expect(nth(entries, 1).textContent).toContain('A team member, 12 October 2026 at');

    await user.click(within(nth(entries, 0)).getByText(/See what changed/));
    expect(within(nth(entries, 0)).getByText('Closing date and time')).toBeTruthy();
    expect(within(nth(entries, 0)).getByText('Before: 2 November 2026 at 5pm')).toBeTruthy();
    expect(within(nth(entries, 0)).getByText('After: 9 November 2026 at 5pm')).toBeTruthy();
  });

  it('shows the latest changes and offers the older ones', async () => {
    const user = userEvent.setup();
    const many = {
      versions: Array.from({ length: 6 }, (_, index) => ({
        ...nth(history.versions, 0),
        version: 6 - index,
      })),
    };
    stubApi({ ...manager(), ...reads, [api.programmeHistory]: ok(many) });
    await open();

    const panel = await screen.findByRole('region', { name: 'Configuration history' });
    expect(await within(panel).findAllByRole('listitem')).toHaveLength(4);
    const more = within(panel).getByRole('button', { name: 'Show 2 older changes' });
    expect(more.getAttribute('aria-expanded')).toBe('false');

    await user.click(more);

    expect(within(panel).getAllByRole('listitem')).toHaveLength(6);
    expect(
      within(panel)
        .getByRole('button', { name: 'Show recent changes only' })
        .getAttribute('aria-expanded'),
    ).toBe('true');
  });

  it('says so when nothing has been saved', async () => {
    stubApi({
      ...manager(),
      ...reads,
      [api.programmeHistory]: ok({ versions: [] }),
    });
    await open();
    expect(await screen.findByText('No changes saved yet.')).toBeTruthy();
  });

  it('shows a failure inside its own panel', async () => {
    stubApi({
      ...manager(),
      ...reads,
      [api.programmeHistory]: problem(
        500,
        'Something went wrong on our side. Try again in a few minutes.',
      ),
    });
    await open();

    const panel = await screen.findByRole('region', { name: 'Configuration history' });
    expect(await within(panel).findByText('We could not load this page')).toBeTruthy();
  });
});
