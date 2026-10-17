// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Check your answers, submitting, and the confirmation.

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { problem, stubApi } from '../testing/api.ts';
import {
  APPLICATION_ID,
  application,
  applicationServer,
  completeAnswers,
} from '../testing/apply.ts';
import { signedIn } from '../testing/party.ts';
import { openPortal, setUpPortalTests } from '../testing/render.tsx';

setUpPortalTests();

const home = `/northfield/applications/${APPLICATION_ID}`;
const SUBMIT = `POST /portal/applications/${APPLICATION_ID}/submit`;
const h1 = (name: string) => screen.findByRole('heading', { level: 1, name });

function open(path: string, start = application()) {
  const server = applicationServer(start);
  const sent = stubApi({ ...signedIn, ...server.handlers });
  openPortal(path);
  return { server, sent };
}

describe('check your answers', () => {
  const check = `${home}/check`;

  it('lists each thing to fix with a link to it, and does not offer to submit', async () => {
    open(check, application({ answers: { f_charity: true, f_name: 'Eastmere' } }));

    const list = await screen.findByRole('region', {
      name: 'Before you can send your application',
    });
    const links = within(list)
      .getAllByRole('link')
      .map((link) => [link.textContent, link.getAttribute('href')?.replace('/northfield', '')]);
    expect(links).toEqual([
      [
        'Do you have a website?: Choose an answer to this question.',
        `/applications/${APPLICATION_ID}/sections/s_about#f_haveweb`,
      ],
      [
        'Contact email address: Enter an answer to this question.',
        `/applications/${APPLICATION_ID}/sections/s_about#f_contact`,
      ],
      [
        'Project summary: Enter an answer to this question.',
        `/applications/${APPLICATION_ID}/sections/s_project#f_summary`,
      ],
      [
        'Costs of the project: Add at least 1 cost.',
        `/applications/${APPLICATION_ID}/sections/s_budget#f_costs`,
      ],
    ]);
    expect(screen.queryByRole('button', { name: 'Submit application' })).toBeNull();
    expect(
      screen.getByText('You can send your application once everything above is done.'),
    ).toBeTruthy();
  });

  it('reads every section back, unanswered questions included, with a way to change each', async () => {
    open(check, application({ answers: { f_charity: true, f_name: 'Eastmere' } }));
    await screen.findByRole('region', { name: 'Before you can send your application' });

    const about = screen.getByRole('heading', { level: 2, name: 'About your organisation' });
    const answers = about.parentElement;
    if (answers === null) throw new Error('The section has no answers.');
    expect(within(answers).getByText('Eastmere')).toBeTruthy();
    expect(within(answers).getAllByText('Not answered').length).toBeGreaterThan(0);
    expect(
      screen.getAllByRole('link', { name: /^Change / }).map((link) => link.textContent),
    ).toEqual([
      'Change Check you can apply',
      'Change About your organisation',
      'Change Your project',
      'Change Budget',
    ]);
    expect(
      screen.getByRole('link', { name: 'Change About your organisation' }).getAttribute('href'),
    ).toBe(`${home}/sections/s_about`);
  });

  it('lists the answer that stops an applicant who cannot apply', async () => {
    open(check, application({ answers: { f_charity: false } }));

    const list = await screen.findByRole('region', {
      name: 'Before you can send your application',
    });
    expect(
      within(list).getByRole('link', {
        name: 'Check you can apply: This programme is open to registered charities only.',
      }),
    ).toHaveProperty('hash', '#f_charity');
    expect(screen.queryByRole('button', { name: 'Submit application' })).toBeNull();
  });

  it('offers to submit when nothing is missing, and shows the confirmation after', async () => {
    const user = userEvent.setup();
    const { server, sent } = open(check, application({ answers: completeAnswers }));

    expect(await h1('Check your answers')).toBeTruthy();
    expect(
      screen.queryByRole('region', { name: 'Before you can send your application' }),
    ).toBeNull();
    await user.click(await screen.findByRole('button', { name: 'Submit application' }));

    expect(await h1('Application submitted')).toBeTruthy();
    expect(sent.find(({ key }) => key === SUBMIT)?.body).toEqual({ basedOn: 1 });
    expect(server.current.status).toBe('submitted');
    expect(window.location.pathname).toBe(`${home}/submitted`);
    expect(await screen.findByText('You do not need to do anything now.')).toBeTruthy();
    expect(screen.getByText(/^Thank you\. We have received your application for/)).toBeTruthy();
    expect(screen.getByText('Submitted')).toBeTruthy();
    expect(screen.getByText(/^21 October 2026 at \d/)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'What happens next' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to your applications' })).toBeTruthy();
  });

  it('says so, and offers the latest answers, when the answers changed since the page opened', async () => {
    const user = userEvent.setup();
    const { server } = open(check, application({ answers: completeAnswers }));
    await screen.findByRole('button', { name: 'Submit application' });
    server.update({ answersVersion: 4 });

    await user.click(screen.getByRole('button', { name: 'Submit application' }));

    const alert = await screen.findByRole('alert');
    expect(
      within(alert).getByText('Your answers were saved somewhere else since you opened this page.'),
    ).toBeTruthy();
    await user.click(within(alert).getByRole('button', { name: 'Show the latest answers' }));
    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
    });
    expect(window.location.pathname).toBe(check);
  });

  it('shows the API’s words when it refuses an application, and says the answers are saved', async () => {
    const user = userEvent.setup();
    const server = applicationServer(application({ answers: completeAnswers }));
    stubApi({
      ...signedIn,
      ...server.handlers,
      [SUBMIT]: problem(422, 'This round closed on 2 November 2026.'),
    });
    openPortal(check);

    await user.click(await screen.findByRole('button', { name: 'Submit application' }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('This round closed on 2 November 2026.')).toBeTruthy();
    expect(within(alert).getByText('Your answers are saved.')).toBeTruthy();
    expect(window.location.pathname).toBe(check);
  });

  it('says it could not send when the connection fails', async () => {
    const user = userEvent.setup();
    const server = applicationServer(application({ answers: completeAnswers }));
    stubApi({ ...signedIn, ...server.handlers, [SUBMIT]: problem(503, 'Busy.') });
    openPortal(check);

    await user.click(await screen.findByRole('button', { name: 'Submit application' }));

    expect(
      await screen.findByText(
        'We could not send your application. Check your connection and try again.',
      ),
    ).toBeTruthy();
  });
});

describe('the confirmation', () => {
  const submitted = application({
    answers: completeAnswers,
    status: 'submitted',
    submittedAt: '2026-10-21T14:14:00.000Z',
  });

  it('shows only the status an applicant may see, whatever stage the application has reached', async () => {
    open(`${home}/submitted`, application({ ...submitted, status: 'under_review' }));

    expect(await h1('Application submitted')).toBeTruthy();
    expect(screen.getByText('Under review')).toBeTruthy();
    expect(screen.getByRole('main').textContent).not.toMatch(/score|stage|reviewer|shortlist/i);
  });

  it('says a draft has not been sent', async () => {
    open(`${home}/submitted`);

    expect(await screen.findByText('You have not sent this application yet.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Continue application' })).toBeTruthy();
  });

  it('says a withdrawn application is withdrawn', async () => {
    open(`${home}/submitted`, application({ ...submitted, status: 'withdrawn' }));

    expect(await screen.findByText('Community Spaces Fund, Spring 2027: Withdrawn.')).toBeTruthy();
  });
});
