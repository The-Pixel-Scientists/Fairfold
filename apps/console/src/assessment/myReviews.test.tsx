// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { problem, stubApi } from '../testing/api.ts';
import { openConsole, setUpConsoleTests } from '../testing/render.tsx';
import { api, heading, manager, ok, reviewer, summary } from './fixtures.ts';

setUpConsoleTests();

const reviews = [
  summary(1),
  summary(2, { progress: { scored: 2, total: 3 } }),
  summary(3, {
    status: 'submitted',
    progress: { scored: 3, total: 3 },
    submittedAt: '2026-10-25T10:00:00.000Z',
  }),
];

const rows = () => screen.getAllByRole('row').slice(1);

describe('my reviews', () => {
  it('lists each review by application and round, never by who applied, with where it stands and what to do next', async () => {
    stubApi({ ...reviewer(), [api.reviews]: ok({ reviews }) });
    openConsole('/northfield/reviews');

    expect(await heading('My reviews')).toBeTruthy();
    await screen.findByRole('table', { name: 'Reviews assigned to you' });
    expect(rows().map((row) => row.textContent)).toEqual([
      'Application 3F2A9C1BAutumn 2026Community Spaces FundReviewNot started0 of 3 criteria scored22 October 2026Start review: Application 3F2A9C1B',
      'Application 3F2A9C1BAutumn 2026Community Spaces FundReviewIn progress2 of 3 criteria scored22 October 2026Continue: Application 3F2A9C1B',
      'Application 3F2A9C1BAutumn 2026Community Spaces FundReviewSubmittedSubmitted on 25 October 202622 October 2026View review: Application 3F2A9C1B',
    ]);
    const stats = screen.getByRole('group', { name: 'Your reviews' });
    expect(stats.textContent).toContain('Assigned to you3');
    expect(screen.getByText('1 of 3 reviews submitted')).toBeTruthy();
  });

  it('opens a review from its link, and from Enter on its row', async () => {
    const user = userEvent.setup();
    stubApi({ ...reviewer(), [api.reviews]: ok({ reviews }) });
    openConsole('/northfield/reviews');
    await screen.findByRole('table', { name: 'Reviews assigned to you' });

    const first = within(rows()[0] as HTMLElement).getByRole('link', {
      name: 'Application 3F2A9C1B',
    });
    expect(first.getAttribute('href')).toBe(`/northfield/reviews/${reviews[0]?.id ?? ''}`);

    (rows()[1] as HTMLElement).focus();
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(window.location.pathname).toBe(`/northfield/reviews/${reviews[1]?.id ?? ''}`);
    });
  });

  it('shows what is still to do, and says so when nothing is', async () => {
    const user = userEvent.setup();
    stubApi({ ...reviewer(), [api.reviews]: ok({ reviews: [reviews[2]] }) });
    openConsole('/northfield/reviews');
    await screen.findByRole('table', { name: 'Reviews assigned to you' });

    await user.click(screen.getByRole('button', { name: /^To do/ }));
    expect(screen.getByRole('heading', { level: 2, name: 'Nothing left to do' })).toBeTruthy();
    expect(screen.getByText('You have submitted every review assigned to you.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^To do/ }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('tells a reviewer with nothing assigned what happens next', async () => {
    stubApi({ ...reviewer(), [api.reviews]: ok({ reviews: [] }) });
    openConsole('/northfield/reviews');

    expect(await screen.findByRole('heading', { level: 2, name: 'No reviews yet' })).toBeTruthy();
    expect(screen.getByText(/A programme manager assigns applications to you/)).toBeTruthy();
  });

  it('says a conflict was declared, after leaving the review', async () => {
    stubApi({ ...reviewer(), [api.reviews]: ok({ reviews: [reviews[0]] }) });
    openConsole('/northfield/reviews?conflict=declared');

    expect(
      await screen.findByText(/You declared a conflict, so the application has left your list/),
    ).toBeTruthy();
  });

  it('says why it did not load and offers another go', async () => {
    const user = userEvent.setup();
    let reads = 0;
    stubApi({
      ...reviewer(),
      [api.reviews]: () => {
        reads += 1;
        return reads === 1
          ? problem(503, 'The service is busy. Try again in a minute.')
          : ok({ reviews });
      },
    });
    openConsole('/northfield/reviews');

    expect(await screen.findByText('The service is busy. Try again in a minute.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('table', { name: 'Reviews assigned to you' })).toBeTruthy();
  });

  it('is for someone who can score, and is in the navigation only for them', async () => {
    stubApi({ ...manager() });
    openConsole('/northfield/reviews');

    expect(
      await screen.findByRole('heading', { level: 2, name: 'You cannot review applications' }),
    ).toBeTruthy();
    const navigation = screen.getByRole('navigation', { name: 'Main' });
    expect(within(navigation).queryByRole('link', { name: 'My reviews' })).toBeNull();
  });

  it('shows a reviewer one link in the navigation', async () => {
    stubApi({ ...reviewer(), [api.reviews]: ok({ reviews }) });
    openConsole('/northfield/reviews');

    await screen.findByRole('table', { name: 'Reviews assigned to you' });
    const link = within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', {
      name: 'My reviews',
    });
    expect(link.getAttribute('aria-current')).toBe('page');
  });
});
