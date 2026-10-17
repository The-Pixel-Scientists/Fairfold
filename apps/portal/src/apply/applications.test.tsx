// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Your applications, and withdrawing one.

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { problem, stubApi } from '../testing/api.ts';
import {
  APPLICATION_ID,
  OTHER_APPLICATION_ID,
  application,
  applicationList,
  summary,
} from '../testing/apply.ts';
import { ok, signedIn } from '../testing/party.ts';
import { openPortal, setUpPortalTests } from '../testing/render.tsx';

setUpPortalTests();

const LIST = 'GET /portal/applications';
const draft = summary();
const sent = summary({
  id: OTHER_APPLICATION_ID,
  status: 'submitted',
  submittedAt: '2026-10-21T12:00:00.000Z',
});

const h1 = (name: string) => screen.findByRole('heading', { level: 1, name });
const cardOf = (heading: HTMLElement) => {
  const card = heading.closest('li');
  if (card === null) throw new Error('The application is not in a list.');
  return within(card);
};

describe('your applications', () => {
  it('lists what to finish and what was sent, each with the status the applicant may see', async () => {
    stubApi({ ...signedIn, [LIST]: applicationList(draft, sent) });
    openPortal('/northfield/applications');

    expect(await h1('Your applications')).toBeTruthy();
    const [toFinish, submitted] = await screen.findAllByRole('heading', { level: 3 });
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(['To finish', 'Sent']);
    if (toFinish === undefined || submitted === undefined) throw new Error('Missing cards.');

    const unfinished = cardOf(toFinish);
    expect(unfinished.getByText('In progress')).toBeTruthy();
    expect(unfinished.getByText('Eastmere Community Garden')).toBeTruthy();
    expect(unfinished.getByText('5pm on 2 November 2026, UK time')).toBeTruthy();
    expect(
      unfinished.getByText('Not sent yet. Everything you have written is saved.'),
    ).toBeTruthy();
    expect(
      unfinished.getByRole('link', {
        name: 'Continue application for Community Spaces Fund, Spring 2027',
      }),
    ).toHaveProperty('pathname', `/northfield/applications/${APPLICATION_ID}`);
    expect(unfinished.queryByRole('button', { name: /^Withdraw/ })).toBeNull();

    const finished = cardOf(submitted);
    expect(finished.getByText('Submitted')).toBeTruthy();
    expect(finished.getByText('21 October 2026')).toBeTruthy();
    expect(
      finished.getByRole('link', {
        name: 'See what happens next for Community Spaces Fund, Spring 2027',
      }),
    ).toHaveProperty('pathname', `/northfield/applications/${OTHER_APPLICATION_ID}/submitted`);
  });

  it('shows an outcome only as the API sends it, once released', async () => {
    stubApi({
      ...signedIn,
      [LIST]: applicationList(
        summary({
          status: 'awarded',
          submittedAt: '2026-10-21T12:00:00.000Z',
          outcome: { result: 'accepted', amount: { amountMinor: 1_000_000, currency: 'GBP' } },
        }),
        summary({
          id: OTHER_APPLICATION_ID,
          status: 'under_review',
          submittedAt: '2026-10-21T12:00:00.000Z',
        }),
      ),
    });
    openPortal('/northfield/applications');
    await h1('Your applications');

    expect(await screen.findByText('Awarded')).toBeTruthy();
    expect(screen.getByText('Under review')).toBeTruthy();
    expect(
      screen.getByText('We are reading your application. We will email you when there is news.'),
    ).toBeTruthy();
    expect(screen.getByRole('main').textContent).not.toMatch(/score|stage|reviewer|shortlist/i);
  });

  it('says to start one when there is none', async () => {
    stubApi({ ...signedIn, [LIST]: applicationList() });
    openPortal('/northfield/applications');

    expect(
      await screen.findByRole('heading', { level: 2, name: 'You have not started an application' }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See programmes you can apply to' })).toHaveProperty(
      'pathname',
      '/northfield/programmes',
    );
  });

  it('offers to try again when the list cannot be read', async () => {
    stubApi({ ...signedIn, [LIST]: problem(503, 'Try later.') });
    openPortal('/northfield/applications');

    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

describe('withdrawing an application', () => {
  const WITHDRAW = `POST /portal/applications/${OTHER_APPLICATION_ID}/withdraw`;
  const setUp = (more = {}) =>
    stubApi({
      ...signedIn,
      [LIST]: applicationList(draft, sent),
      [WITHDRAW]: ok(
        application({
          id: OTHER_APPLICATION_ID,
          status: 'withdrawn',
          withdrawnAt: '2026-10-22T09:00:00.000Z',
        }),
      ),
      ...more,
    });

  async function ask(user: ReturnType<typeof userEvent.setup>) {
    openPortal('/northfield/applications');
    await user.click(
      await screen.findByRole('button', {
        name: 'Withdraw application for Community Spaces Fund, Spring 2027',
      }),
    );
    return screen.findByRole('dialog', { name: 'Withdraw this application?' });
  }

  it('asks first, and says it cannot be undone', async () => {
    const user = userEvent.setup();
    const sentRequests = setUp();

    const dialog = await ask(user);

    expect(within(dialog).getByText(/You cannot undo this\./)).toBeTruthy();
    expect(within(dialog).getByText(/must start a new application/)).toBeTruthy();
    expect(document.activeElement).toBe(
      within(dialog).getByRole('button', { name: 'Keep my application' }),
    );
    expect(sentRequests.some(({ key }) => key === WITHDRAW)).toBe(false);
  });

  it('keeps the application when the applicant changes their mind', async () => {
    const user = userEvent.setup();
    const sentRequests = setUp();
    const dialog = await ask(user);

    await user.click(within(dialog).getByRole('button', { name: 'Keep my application' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(sentRequests.some(({ key }) => key === WITHDRAW)).toBe(false);
    expect(screen.getByText('Submitted')).toBeTruthy();
  });

  it('withdraws it once confirmed, and says so', async () => {
    const user = userEvent.setup();
    const sentRequests = setUp();
    const dialog = await ask(user);

    await user.click(within(dialog).getByRole('button', { name: 'Withdraw application' }));

    const notice = await screen.findByText(
      'Your application to Community Spaces Fund, Spring 2027 is withdrawn.',
    );
    expect(sentRequests.some(({ key }) => key === WITHDRAW)).toBe(true);
    expect(notice.getAttribute('role')).toBe('status');
    expect(document.activeElement).toBe(notice);
    expect(screen.getByText('Withdrawn')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Withdraw application/ })).toBeNull();
  });

  it('keeps the dialog open and says why when it cannot withdraw', async () => {
    const user = userEvent.setup();
    setUp({
      [WITHDRAW]: problem(409, 'This decision has been released, so it cannot be withdrawn.'),
    });
    const dialog = await ask(user);

    await user.click(within(dialog).getByRole('button', { name: 'Withdraw application' }));

    expect(
      await within(dialog).findByText(
        'This decision has been released, so it cannot be withdrawn.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Submitted')).toBeTruthy();
  });
});
