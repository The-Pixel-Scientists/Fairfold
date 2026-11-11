// SPDX-License-Identifier: AGPL-3.0-or-later
//
// An applicant with more time sees their own deadline, and an applicant whose
// funder sent the application sees that it was sent and exactly what was sent.

import type { Application } from '@pixel-scientists/grants/contracts';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { stubApi } from '../testing/api.ts';
import {
  APPLICATION_ID,
  application,
  applicationList,
  applicationServer,
  completeAnswers,
  summary,
} from '../testing/apply.ts';
import { noMonitoring } from '../testing/monitoring.ts';
import { signedIn } from '../testing/party.ts';
import { openPortal, setUpPortalTests } from '../testing/render.tsx';

setUpPortalTests();

const home = `/northfield/applications/${APPLICATION_ID}`;
const SENT = '2026-10-21T12:00:00.000Z';
const h1 = (name: string) => screen.findByRole('heading', { level: 1, name });
const mainText = () => screen.getByRole('main').textContent;

function open(path: string, start: Application) {
  const server = applicationServer(start);
  stubApi({ ...signedIn, ...server.handlers, ...noMonitoring });
  openPortal(path);
}

const extended = application({ closesAt: '2026-11-16T17:00' });
const assisted = application({
  status: 'submitted',
  submittedAt: SENT,
  submissionRoute: 'assisted',
  answers: completeAnswers,
});

describe('an extended deadline', () => {
  it('says the applicant has more time, with their own deadline and no other', async () => {
    open(home, extended);

    expect(await h1('Your application')).toBeTruthy();
    expect(
      await screen.findByText(
        'You have more time to apply. Your deadline is 5pm on 16 November 2026, UK time.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Your deadline')).toBeTruthy();
    expect(screen.getByText('5pm on 16 November 2026, UK time')).toBeTruthy();
    expect(mainText()).not.toContain('2 November');
  });

  it('says nothing about more time when the deadline is the round’s', async () => {
    open(home, application({ closesAt: '2026-11-02T17:00' }));

    expect(await screen.findByText('Applications close')).toBeTruthy();
    expect(mainText()).not.toContain('more time');
  });

  it('shows the applicant’s deadline on the check page', async () => {
    open(`${home}/check`, extended);

    expect(
      await screen.findByText('Your deadline is 5pm on 16 November 2026, UK time.'),
    ).toBeTruthy();
  });

  it('shows it in the list', async () => {
    stubApi({
      ...signedIn,
      'GET /portal/applications': applicationList(summary({ closesAt: '2026-11-16T17:00' })),
    });
    openPortal('/northfield/applications');

    expect(await screen.findByText('Your deadline')).toBeTruthy();
    expect(screen.getByText('5pm on 16 November 2026, UK time')).toBeTruthy();
  });

  it('carries no reason, kind or staff name', async () => {
    open(home, extended);
    await h1('Your application');

    expect(mainText()).not.toMatch(/extension|reason|access|adjust|staff/i);
  });
});

describe('an application the funder sent', () => {
  it('says so on the application page, with the time in UK time and no name', async () => {
    open(home, assisted);

    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: 'The funder sent this application for you',
      }),
    ).toBeTruthy();
    expect(screen.getByText(/It was sent on 21 October 2026 at 1pm, UK time\./)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See what was sent' })).toHaveProperty(
      'pathname',
      `${home}/sent`,
    );
  });

  it('shows no such panel for an application the applicant sent', async () => {
    open(home, application({ status: 'submitted', submittedAt: SENT, submissionRoute: 'portal' }));

    expect(await screen.findByRole('link', { name: 'See your application' })).toBeTruthy();
    expect(screen.queryByText(/sent this application for you/)).toBeNull();
    expect(screen.queryByRole('link', { name: 'See what was sent' })).toBeNull();
  });

  it('also shows the panel on the page that confirms what was sent', async () => {
    open(`${home}/submitted`, assisted);

    expect(await screen.findByText('The funder sent this application for you')).toBeTruthy();
  });

  it('reads back the answers, read only', async () => {
    const user = userEvent.setup();
    open(home, assisted);

    await user.click(await screen.findByRole('link', { name: 'See what was sent' }));

    expect(await h1('What was sent')).toBeTruthy();
    expect(await screen.findByText('A weekly lunch for older people.')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('does not show a draft’s answers as sent', async () => {
    open(`${home}/sent`, application({ answers: completeAnswers }));

    expect(await screen.findByText('You have not sent this application yet.')).toBeTruthy();
    expect(screen.queryByText('A weekly lunch for older people.')).toBeNull();
  });
});
