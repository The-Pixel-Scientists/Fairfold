// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What an applicant is told about their application: before release only the
// status, and from release the outcome, in words that suit a reading age of
// about 11 (docs/CONTENT-STYLE.md).

import type { Application } from '@pixel-scientists/grants/contracts';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { problem, stubApi } from '../testing/api.ts';
import {
  APPLICATION_ID,
  OTHER_APPLICATION_ID,
  application,
  applicationList,
  applicationServer,
  summary,
} from '../testing/apply.ts';
import { signedIn } from '../testing/party.ts';
import { openPortal, sentencesIn, setUpPortalTests } from '../testing/render.tsx';

setUpPortalTests();

const home = `/northfield/applications/${APPLICATION_ID}`;
const SENT = '2026-10-21T12:00:00.000Z';

const awarded = application({
  status: 'awarded',
  submittedAt: SENT,
  outcome: { result: 'accepted', amount: { amountMinor: 1_250_000, currency: 'GBP' } },
});
const waitlisted = application({
  status: 'waitlisted',
  submittedAt: SENT,
  outcome: { result: 'waitlisted' },
});
const declined = application({
  status: 'not_funded',
  submittedAt: SENT,
  outcome: { result: 'declined' },
});

/** Each state with no outcome, which is all that an applicant is sent before release. */
const unreleased = [
  ['in progress', application()],
  ['submitted', application({ status: 'submitted', submittedAt: SENT })],
  ['under review', application({ status: 'under_review', submittedAt: SENT })],
  ['withdrawn', application({ status: 'withdrawn', submittedAt: SENT })],
] as const;

function open(path: string, start: Application) {
  stubApi({ ...signedIn, ...applicationServer(start).handlers });
  openPortal(path);
}

const h1 = (name: string) => screen.findByRole('heading', { level: 1, name });
const mainText = () => screen.getByRole('main').textContent;

/** Words that tell an applicant an outcome, which must not appear before it is released. */
const OUTCOME_WORDS =
  /awarded|waiting list|not funded|could not (fund|offer)|successful|congratulations|£\d/i;
const INSIDE_WORDS = /score|stage|reviewer|shortlist|rank|panel/i;

describe('the outcome of an award', () => {
  it('says how much was awarded, who it is for and what happens next', async () => {
    open(`${home}/outcome`, awarded);

    expect(await h1('Your application was successful')).toBeTruthy();
    expect(mainText()).toContain('You have been awarded £12,500');
    expect(screen.getByText('Awarded')).toBeTruthy();
    expect(
      screen.getByText(
        'This is for Eastmere Community Garden, from Community Spaces Fund, Spring 2027.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'What happens next' })).toBeTruthy();
    expect(
      screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent),
    ).toEqual(['Read our email', 'We tell you about your grant']);
  });

  it('follows the breadcrumbs back to the application and the list', async () => {
    open(`${home}/outcome`, awarded);
    await h1('Your application was successful');

    const trail = within(screen.getByRole('navigation', { name: /breadcrumb/i }));
    expect(trail.getByRole('link', { name: 'Your applications' })).toHaveProperty(
      'pathname',
      '/northfield/applications',
    );
    expect(trail.getByRole('link', { name: 'Community Spaces Fund, Spring 2027' })).toHaveProperty(
      'pathname',
      home,
    );
    expect(screen.getByRole('link', { name: 'Back to your applications' })).toHaveProperty(
      'pathname',
      '/northfield/applications',
    );
  });
});

describe('the outcome of a place on the waiting list', () => {
  it('says what the waiting list means and what the applicant can do', async () => {
    open(`${home}/outcome`, waitlisted);

    expect(await h1('You are on our waiting list')).toBeTruthy();
    expect(screen.getByText('On the waiting list')).toBeTruthy();
    expect(screen.getByText('We cannot offer you a grant yet.')).toBeTruthy();
    expect(
      screen.getByRole('heading', { level: 2, name: 'What the waiting list means' }),
    ).toBeTruthy();
    expect(screen.getByText(/we will email you\. We cannot say if or when/)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'What you can do' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See programmes you can apply to' })).toHaveProperty(
      'pathname',
      '/northfield/programmes',
    );
    expect(mainText()).not.toMatch(/£\d/);
  });
});

describe('the outcome of a decision not to fund', () => {
  it('says it kindly and plainly, and says what the applicant can do next', async () => {
    open(`${home}/outcome`, declined);

    expect(await h1('We could not fund your application')).toBeTruthy();
    expect(
      screen.getByText('Thank you for applying. We know this is not the news you hoped for.'),
    ).toBeTruthy();
    expect(screen.getByText('Not funded')).toBeTruthy();
    expect(screen.getByText('We could not offer you a grant this time.')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'What you can do next' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See programmes you can apply to' })).toHaveProperty(
      'pathname',
      '/northfield/programmes',
    );
    expect(mainText()).not.toMatch(/£\d/);
  });
});

describe.each(unreleased)('the outcome page of an application that is %s', (_state, start) => {
  it('shows only the status, with no outcome area and no wording that hints at one', async () => {
    open(`${home}/outcome`, start);

    expect(await h1('Your application')).toBeTruthy();
    await screen.findByRole('link', { name: 'Go to your applications' });
    expect(screen.getByRole('main').textContent).toContain('Community Spaces Fund, Spring 2027: ');
    expect(mainText()).not.toMatch(OUTCOME_WORDS);
    expect(mainText()).not.toMatch(INSIDE_WORDS);
    expect(screen.queryByRole('link', { name: 'Read your outcome' })).toBeNull();
  });
});

describe('the way to the outcome', () => {
  it('is offered on the application page and on the page after sending, once released', async () => {
    open(home, awarded);

    expect(await screen.findByText('Awarded')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Read your outcome' })).toHaveProperty(
      'pathname',
      `${home}/outcome`,
    );
  });

  it('is offered on the status page after sending, once released', async () => {
    open(`${home}/submitted`, waitlisted);

    expect(await screen.findByText(/: On the waiting list\.$/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Read your outcome' })).toHaveProperty(
      'pathname',
      `${home}/outcome`,
    );
  });

  it.each(unreleased.filter(([, start]) => start.status !== 'in_progress'))(
    'is not offered, and the status shows, while the application is %s',
    async (_state, start) => {
      open(home, start);

      expect(await screen.findByText('Status')).toBeTruthy();
      expect(
        screen.getByText(start.status === 'withdrawn' ? 'Withdrawn' : /^(Submitted|Under review)$/),
      ).toBeTruthy();
      expect(screen.queryByRole('link', { name: 'Read your outcome' })).toBeNull();
      expect(mainText()).not.toMatch(OUTCOME_WORDS);
    },
  );

  it('is offered on each released application in the list, with the same labels', async () => {
    stubApi({
      ...signedIn,
      'GET /portal/applications': applicationList(
        summary({
          status: 'awarded',
          submittedAt: SENT,
          outcome: { result: 'accepted', amount: { amountMinor: 1_250_000, currency: 'GBP' } },
        }),
        summary({ id: OTHER_APPLICATION_ID, status: 'under_review', submittedAt: SENT }),
      ),
    });
    openPortal('/northfield/applications');

    const link = await screen.findByRole('link', {
      name: 'Read your outcome for Community Spaces Fund, Spring 2027',
    });
    expect(link).toHaveProperty('pathname', `${home}/outcome`);
    expect(screen.getAllByRole('link', { name: /^Read your outcome/ })).toHaveLength(1);
    expect(screen.getByText('Awarded')).toBeTruthy();
    expect(screen.getByText('Amount awarded')).toBeTruthy();
    expect(screen.getByText('£12,500')).toBeTruthy();
    expect(screen.getByText('Under review')).toBeTruthy();
  });

  it('shows a waiting list place and a decision not to fund in the list, without an amount', async () => {
    stubApi({
      ...signedIn,
      'GET /portal/applications': applicationList(
        summary({ status: 'waitlisted', submittedAt: SENT, outcome: { result: 'waitlisted' } }),
        summary({
          id: OTHER_APPLICATION_ID,
          status: 'not_funded',
          submittedAt: SENT,
          outcome: { result: 'declined' },
        }),
      ),
    });
    openPortal('/northfield/applications');

    expect(await screen.findByText('On the waiting list')).toBeTruthy();
    expect(screen.getByText('Not funded')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /^Read your outcome/ })).toHaveLength(2);
    expect(screen.queryByText('Amount awarded')).toBeNull();
  });
});

describe('when the application cannot be read', () => {
  it('says it cannot find an application that is not the applicant’s', async () => {
    stubApi({ ...signedIn, [`GET /portal/applications/${APPLICATION_ID}`]: problem(404, 'No.') });
    openPortal(`${home}/outcome`);

    expect(
      await screen.findByText('We cannot find this application. It may belong to someone else.'),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to your applications' })).toBeTruthy();
  });

  it('offers to try again when it could not be loaded', async () => {
    stubApi({
      ...signedIn,
      [`GET /portal/applications/${APPLICATION_ID}`]: problem(503, 'Try later.'),
    });
    openPortal(`${home}/outcome`);

    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

describe.each([
  ['an award', awarded],
  ['a place on the waiting list', waitlisted],
  ['a decision not to fund', declined],
])('the words of %s', (_name, start) => {
  it('keeps every sentence short, and never apologises, blames the person or names anything from inside the funder', async () => {
    open(`${home}/outcome`, start);
    await screen.findByRole('link', { name: 'Back to your applications' });

    for (const sentence of sentencesIn(screen.getByRole('main'))) {
      expect(sentence.split(/\s+/).length, sentence).toBeLessThanOrEqual(25);
    }
    expect(mainText()).not.toMatch(/sorry|apolog|your fault|invalid|verif|likely|chance of/i);
    expect(mainText()).not.toMatch(INSIDE_WORDS);
  });

  it('uses links that say what happens', async () => {
    open(`${home}/outcome`, start);
    await screen.findByRole('link', { name: 'Back to your applications' });

    for (const control of [...screen.queryAllByRole('button'), ...screen.queryAllByRole('link')]) {
      expect(control.textContent).not.toMatch(/^(submit|ok|click here|here|next|more)$/i);
    }
  });
});
