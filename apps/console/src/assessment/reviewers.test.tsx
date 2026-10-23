// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { reads as programmeReads, programme, round } from '../programme/fixtures.ts';
import { problem, stubApi } from '../testing/api.ts';
import { joined } from '../testing/names.ts';
import { openConsole, setUpConsoleTests } from '../testing/render.tsx';
import { api, heading, manager, ok, people, reviewer } from './fixtures.ts';

setUpConsoleTests();

const PATH = `/northfield/rounds/${round.id}/reviewers`;

const pool = [
  { ...people.priya, openAssignments: 2, assignments: 3 },
  { ...people.tom, openAssignments: 0, assignments: 0 },
  { ...people.owen, openAssignments: 0, assignments: 0 },
];

const pageReads = (reviewers = pool, members: readonly object[] = [people.hannah]) => ({
  ...manager(),
  [api.round]: ok(round),
  [api.programme]: ok(programme),
  [api.pool]: ok({ reviewers }),
  [api.candidates]: ok({ members }),
});

describe("a round's reviewer pool", () => {
  it('lists the pool with each reviewer’s open and total reviews, and who can be added', async () => {
    stubApi(pageReads());
    openConsole(PATH);

    expect(await heading('Reviewers')).toBeTruthy();
    const table = await screen.findByRole('table', { name: 'Reviewers in the pool' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([
      'Priya Shah23Has reviews',
      'Tom Okafor00Remove Tom Okafor from the pool',
      'Unnamed member00Remove Unnamed member from the pool',
    ]);
    expect(screen.getByRole('checkbox', { name: 'Hannah Lewis' })).toBeTruthy();
    expect(screen.getByText(/A reviewer with reviews assigned cannot be removed/)).toBeTruthy();
    const breadcrumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(breadcrumbs).getByText('Autumn 2026')).toBeTruthy();
  });

  it('adds the members chosen and reads the pool again', async () => {
    const user = userEvent.setup();
    let added = false;
    const sent = stubApi({
      ...pageReads(),
      [api.pool]: () =>
        ok({
          reviewers: added
            ? [...pool, { ...people.hannah, openAssignments: 0, assignments: 0 }]
            : pool,
        }),
      [api.candidates]: () => ok({ members: added ? [] : [people.hannah] }),
      [api.addToPool]: () => {
        added = true;
        return ok({ reviewers: pool });
      },
    });
    openConsole(PATH);

    await user.click(await screen.findByRole('checkbox', { name: 'Hannah Lewis' }));
    await user.click(screen.getByRole('button', { name: 'Add 1 reviewer' }));

    const status = await screen.findByText('1 reviewer added to the pool.');
    expect(document.activeElement).toBe(status);
    expect(sent.find(({ key }) => key === api.addToPool)?.body).toEqual({
      membershipIds: [people.hannah.membershipId],
    });
    expect(screen.getByText(/Everyone who can review is already in the pool/)).toBeTruthy();
    expect(screen.getByRole('row', { name: /Hannah Lewis/ })).toBeTruthy();
  });

  it('asks before removing a reviewer with no reviews, then removes them', async () => {
    const user = userEvent.setup();
    let removed = false;
    const sent = stubApi({
      ...pageReads(),
      [api.pool]: () => ok({ reviewers: removed ? [pool[0]] : pool }),
      [api.removeFromPool(people.tom.membershipId)]: () => {
        removed = true;
        return { status: 204 };
      },
    });
    openConsole(PATH);

    await user.click(
      await screen.findByRole('button', { name: joined('Remove', 'Tom Okafor from the pool') }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Remove Tom Okafor from the pool?' });
    expect(document.activeElement).toBe(
      within(dialog).getByRole('button', { name: 'Keep in the pool' }),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Remove from the pool' }));

    expect(await screen.findByText('Tom Okafor removed from the pool.')).toBeTruthy();
    expect(sent.some(({ key }) => key === api.removeFromPool(people.tom.membershipId))).toBe(true);
    expect(screen.queryByRole('row', { name: /Tom Okafor/ })).toBeNull();
  });

  it('says why the API refused, in the dialog', async () => {
    const user = userEvent.setup();
    stubApi({
      ...pageReads(),
      [api.removeFromPool(people.tom.membershipId)]: problem(
        409,
        'This reviewer has been assigned reviews, so they cannot be removed.',
      ),
    });
    openConsole(PATH);

    await user.click(
      await screen.findByRole('button', { name: joined('Remove', 'Tom Okafor from the pool') }),
    );
    await user.click(screen.getByRole('button', { name: 'Remove from the pool' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('cannot be removed');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('tells a manager with an empty pool what to do next', async () => {
    stubApi(pageReads([], [people.hannah]));
    openConsole(PATH);

    expect(
      await screen.findByRole('heading', { level: 3, name: 'No reviewers in this round yet' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Add to the pool' }).getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('says why it did not load and offers another go', async () => {
    const user = userEvent.setup();
    let reads = 0;
    stubApi({
      ...pageReads(),
      [api.pool]: () => {
        reads += 1;
        return reads === 1
          ? problem(503, 'The service is busy. Try again in a minute.')
          : ok({ reviewers: pool });
      },
    });
    openConsole(PATH);

    expect(await screen.findByText('The service is busy. Try again in a minute.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => {
      expect(screen.getByRole('table', { name: 'Reviewers in the pool' })).toBeTruthy();
    });
  });

  it('is for someone who can assign reviewers', async () => {
    stubApi({ ...reviewer() });
    openConsole(PATH);

    expect(await heading('Reviewers')).toBeTruthy();
    expect(
      screen.getByRole('heading', { level: 2, name: 'You cannot manage reviewers' }),
    ).toBeTruthy();
  });

  it('shows page not found for an address that is not a real id', async () => {
    stubApi({ ...manager(), ...programmeReads });
    openConsole('/northfield/rounds/autumn/reviewers');

    expect(await heading('Page not found')).toBeTruthy();
  });
});
