// SPDX-License-Identifier: AGPL-3.0-or-later
//
// An application as a task list, its eligibility questions, and its sections.

import { screen, within } from '@testing-library/react';
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
const h1 = (name: string) => screen.findByRole('heading', { level: 1, name });

function open(path: string, start = application()) {
  const server = applicationServer(start);
  const sent = stubApi({ ...signedIn, ...server.handlers });
  openPortal(path);
  return { server, sent };
}

/** Each item of the task list: its words and where it goes. */
async function tasks() {
  const list = await screen.findByRole('list', { name: 'Application sections' });
  return within(list)
    .getAllByRole('listitem')
    .map((item) => [
      item.textContent,
      item.querySelector('a')?.getAttribute('href')?.replace('/northfield', '') ?? null,
    ]);
}

describe('the application as a task list', () => {
  it('puts eligibility first and keeps the other sections until the applicant can apply', async () => {
    open(home);

    expect(await h1('Your application')).toBeTruthy();
    expect(await tasks()).toEqual([
      [
        'Check you can applyAnswer these first, so you know you can apply.Not started',
        `/applications/${APPLICATION_ID}/eligibility`,
      ],
      ['About your organisationCheck you can apply first.Cannot start yet', null],
      ['Your projectCheck you can apply first.Cannot start yet', null],
      ['BudgetCheck you can apply first.Cannot start yet', null],
    ]);
    expect(screen.getByRole('link', { name: 'Continue with Check you can apply' })).toHaveProperty(
      'pathname',
      `/northfield/applications/${APPLICATION_ID}/eligibility`,
    );
    expect(screen.getByText('This application is for Eastmere Community Garden.')).toBeTruthy();
    expect(screen.getByText('5pm on 2 November 2026, UK time')).toBeTruthy();
    expect(screen.getByText(/^Saved at /)).toBeTruthy();
    expect(screen.getByText('We save as you type, so nothing is lost.')).toBeTruthy();
  });

  it('shows where each section stands once the applicant can apply, and continues with the first not done', async () => {
    open(
      home,
      application({
        answers: { f_charity: true, f_name: 'Eastmere', f_summary: 'A weekly lunch.' },
      }),
    );

    expect(await tasks()).toEqual([
      ['Check you can applyCompleted', `/applications/${APPLICATION_ID}/eligibility`],
      [
        'About your organisation2 questions to finish.In progress',
        `/applications/${APPLICATION_ID}/sections/s_about`,
      ],
      ['Your projectCompleted', `/applications/${APPLICATION_ID}/sections/s_project`],
      ['BudgetNot started', `/applications/${APPLICATION_ID}/sections/s_budget`],
    ]);
    expect(
      screen.getByRole('meter', { name: 'Sections completed' }).getAttribute('aria-valuetext'),
    ).toBe('2 of 4');
    expect(
      screen.getByRole('link', { name: 'Continue with About your organisation' }),
    ).toBeTruthy();
  });

  it('offers to check the answers once every section is complete', async () => {
    open(home, application({ answers: completeAnswers }));

    await tasks();
    expect(
      screen.getByRole('meter', { name: 'Sections completed' }).getAttribute('aria-valuetext'),
    ).toBe('4 of 4');
    expect(screen.getAllByRole('link', { name: 'Check your answers' })).toHaveLength(1);
  });

  it('locks the sections of an applicant who cannot apply, and says why', async () => {
    open(home, application({ answers: { f_charity: false } }));

    expect(await tasks()).toEqual([
      [
        'Check you can applyYour answer means you cannot apply. You can change it.In progress',
        `/applications/${APPLICATION_ID}/eligibility`,
      ],
      ['About your organisationYou cannot apply with your answers.Cannot start yet', null],
      ['Your projectYou cannot apply with your answers.Cannot start yet', null],
      ['BudgetYou cannot apply with your answers.Cannot start yet', null],
    ]);
  });

  it('does not offer to change an application that has been sent', async () => {
    open(home, application({ status: 'submitted', submittedAt: '2026-10-21T14:14:00.000Z' }));

    expect(
      await screen.findByText(
        'You cannot change this application, because you have sent it or withdrawn it.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See your application' })).toHaveProperty(
      'pathname',
      `/northfield/applications/${APPLICATION_ID}/submitted`,
    );
    expect(screen.queryByRole('list', { name: 'Application sections' })).toBeNull();
  });

  it('says it cannot find an application that is not the applicant’s', async () => {
    stubApi({
      ...signedIn,
      [`GET /portal/applications/${APPLICATION_ID}`]: problem(404, 'Not found.'),
    });
    openPortal(home);

    expect(
      await screen.findByText('We cannot find this application. It may belong to someone else.'),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to your applications' })).toBeTruthy();
  });
});

describe('the eligibility questions', () => {
  const eligibility = `${home}/eligibility`;

  it('stops an ineligible applicant with the reason, and lets them change the answer', async () => {
    const user = userEvent.setup();
    open(eligibility);
    await h1('Check you can apply');

    await user.click(await screen.findByRole('radio', { name: 'No' }));

    const stop = await screen.findByRole('alert');
    expect(within(stop).getByText('You cannot apply with this answer')).toBeTruthy();
    expect(
      within(stop).getByText('This programme is open to registered charities only.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save and continue' })).toBeNull();

    await user.click(within(stop).getByRole('button', { name: 'Change your answer' }));
    expect(document.activeElement?.id).toBe('f_charity');
    await user.click(screen.getByRole('radio', { name: 'Yes' }));

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save and continue' })).toBeTruthy();
  });

  it('asks for an answer before it carries on, and sends nothing', async () => {
    const user = userEvent.setup();
    const { server } = open(eligibility);

    await user.click(await screen.findByRole('button', { name: 'Save and continue' }));

    const summary = await screen.findByRole('alert', { name: 'There is a problem' });
    expect(within(summary).getByText('Choose an answer to this question.')).toBeTruthy();
    expect(server.saved).toEqual([]);
  });

  it('saves the answer, has the server check it, and goes to the application', async () => {
    const user = userEvent.setup();
    const { server, sent } = open(eligibility);

    await user.click(await screen.findByRole('radio', { name: 'Yes' }));
    await user.click(screen.getByRole('button', { name: 'Save and continue' }));

    expect(await h1('Your application')).toBeTruthy();
    expect(window.location.pathname).toBe(`/northfield/applications/${APPLICATION_ID}`);
    expect(server.saved).toEqual([{ basedOn: 1, answers: { f_charity: true } }]);
    expect(sent.map(({ key }) => key).filter((key) => !key.startsWith('GET'))).toEqual([
      `PUT /portal/applications/${APPLICATION_ID}/answers`,
      `POST /portal/applications/${APPLICATION_ID}/eligibility-check`,
    ]);
  });

  it('tells the applicant a section is locked until they have checked they can apply', async () => {
    open(`${home}/sections/s_project`);

    expect(await h1('Your project')).toBeTruthy();
    expect(screen.getByText('Check you can apply before you start this section.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Check you can apply' })).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('a section', () => {
  const eligible = application({ answers: { f_charity: true } });

  it('is one section on a screen, with its place in the application', async () => {
    open(`${home}/sections/s_project`, eligible);

    expect(await h1('Your project')).toBeTruthy();
    expect(screen.getByText('Section 2 of 3')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /Project summary/ })).toBeTruthy();
    expect(screen.getByText('Say what you will do and who it is for.')).toBeTruthy();
    expect(screen.getAllByText('You have 50 words left').length).toBeGreaterThan(0);
    const crumbs = within(screen.getByRole('navigation', { name: 'Breadcrumb' }));
    expect(crumbs.getByRole('link', { name: 'Your applications' })).toBeTruthy();
    expect(crumbs.getByRole('link', { name: 'Community Spaces Fund, Spring 2027' })).toBeTruthy();
    expect(
      screen.getByText('We save your answers as you type. You can leave at any time.'),
    ).toBeTruthy();
    expect(document.title).toBe('Section 2 of 3: Your project – Fairfold Grants');
  });

  it('moves focus to its heading once it has loaded', async () => {
    open(`${home}/sections/s_project`, eligible);

    const heading = await h1('Your project');

    expect(document.activeElement).toBe(heading);
  });

  it('opens at the question a link names', async () => {
    open(`${home}/sections/s_project#f_people`, eligible);

    await h1('Your project');

    expect(document.activeElement?.id).toBe('f_people');
  });

  it('shows a question only when an earlier answer asks for it', async () => {
    const user = userEvent.setup();
    open(`${home}/sections/s_about`, eligible);
    await h1('About your organisation');
    expect(screen.queryByRole('textbox', { name: /Website address/ })).toBeNull();

    await user.click(screen.getByRole('radio', { name: 'Yes' }));

    expect(screen.getByRole('textbox', { name: /Website address/ })).toBeTruthy();
  });

  it('goes to the next section, and from the last to the check page', async () => {
    const user = userEvent.setup();
    open(`${home}/sections/s_project`, eligible);

    await user.click(await screen.findByRole('button', { name: 'Save and continue' }));
    expect(await h1('Budget')).toBeTruthy();
    expect(window.location.pathname).toBe(`${home}/sections/s_budget`);
    expect(screen.getByText('Section 3 of 3')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Save and check your answers' }));
    expect(await h1('Check your answers')).toBeTruthy();
  });

  it('opens the next section on the answers the last one saved', async () => {
    const user = userEvent.setup();
    const { server } = open(`${home}/sections/s_project`, eligible);

    await user.type(
      await screen.findByRole('textbox', { name: /^Project summary/ }),
      'A weekly lunch.',
    );
    await user.click(screen.getByRole('button', { name: 'Save and continue' }));
    await h1('Budget');
    await user.click(screen.getByRole('button', { name: 'Add the first cost' }));
    await user.type(screen.getByRole('textbox', { name: /^Item/ }), 'Hall hire');
    await user.click(screen.getByRole('button', { name: 'Save and check your answers' }));

    await h1('Check your answers');
    expect(server.saved.map(({ basedOn }) => basedOn)).toEqual([1, 2]);
    expect(server.current.answers).toMatchObject({
      f_summary: 'A weekly lunch.',
      f_costs: [{ c_item: 'Hall hire' }],
    });
  });

  it('goes back to the application to come back later', async () => {
    const user = userEvent.setup();
    open(`${home}/sections/s_project`, eligible);

    await user.click(await screen.findByRole('button', { name: 'Save and come back later' }));

    expect(await h1('Your application')).toBeTruthy();
  });

  it('says a section that is not in the application is not found', async () => {
    open(`${home}/sections/s_nothing`, eligible);

    expect(await h1('We cannot find this section')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to your application' })).toBeTruthy();
  });

  it('refuses an address that is not a section’s id', async () => {
    open(`${home}/sections/not-a-section`, eligible);

    expect(await h1('Page not found')).toBeTruthy();
  });

  it('fills in a table of costs and adds them up', async () => {
    const user = userEvent.setup();
    const { server } = open(`${home}/sections/s_budget`, eligible);
    await h1('Budget');

    await user.click(screen.getByRole('button', { name: 'Add the first cost' }));
    await user.type(screen.getByRole('textbox', { name: /^Item/ }), 'Hall hire');
    await user.type(screen.getByRole('textbox', { name: /^Cost/ }), '2880');

    expect(await screen.findByText('£2,880', {}, { timeout: 4000 })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save and check your answers' }));
    await h1('Check your answers');
    expect(server.saved.at(-1)?.answers['f_costs']).toEqual([
      { c_item: 'Hall hire', c_cost: { amountMinor: 288_000, currency: 'GBP' } },
    ]);
  });
});
