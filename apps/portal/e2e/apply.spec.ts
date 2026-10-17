// SPDX-License-Identifier: AGPL-3.0-or-later
//
// An applicant choosing a programme, being checked for eligibility, filling the
// form over two sittings, seeing what is missing, submitting, and withdrawing,
// in a real browser, with the API's answers stubbed (apply-api.ts). The same
// journey runs against the real API in apply-journey.spec.ts.

import type { Page } from '@playwright/test';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import { applicantSession, problem, signedOut } from './auth-api.ts';
import {
  APPLICATION_ID,
  SENT_APPLICATION_ID,
  completeAnswers,
  draft,
  sent,
  stubApply,
} from './apply-api.ts';

const SUFFIX = '– Fairfold Grants';

const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });
const saved = (page: Page) => page.getByText(/^Saved at \d/);
const home = `/northfield/applications/${APPLICATION_ID}`;
const eligible = { f_charity: true };

test.describe('finding a programme', () => {
  test('lists each open round with its closing time and award range, then the round’s page', async ({
    page,
  }) => {
    await stubApply(page);
    await page.goto('/northfield/programmes');

    await expect(h1(page, 'Programmes you can apply to')).toBeVisible();
    await expect(page).toHaveTitle(`Programmes you can apply to ${SUFFIX}`);
    const card = page.getByRole('listitem').filter({ hasText: 'Community Spaces Fund' });
    await expect(card.getByText('5pm on 2 November 2026, UK time')).toBeVisible();
    await expect(card.getByText('£5,000 to £25,000')).toBeVisible();
    await card.getByRole('link', { name: 'Read more and apply for Community Spaces Fund' }).click();

    await expect(h1(page, 'Community Spaces Fund')).toBeFocused();
    await expect(page).toHaveTitle(`Community Spaces Fund ${SUFFIX}`);
    await expect(page.getByText('We pay for the everyday costs of a project.')).toBeVisible();
    await expect(
      page.getByText('This programme is open to registered charities only.'),
    ).toBeVisible();
    await expect(page.getByText(/^It takes about 15 minutes\./)).toBeVisible();
    await expect(page.getByText('Costs of the project')).toBeVisible();
  });

  test('says to check back later when nothing is open', async ({ page }) => {
    await stubApply(page, { open: false });
    await page.goto('/northfield/programmes');

    await expect(
      page.getByRole('heading', { level: 2, name: 'No programmes are open at the moment' }),
    ).toBeVisible();
    await expect(page.getByText(/^Check back later\./)).toBeVisible();
  });

  test('links to add an organisation when the applicant has none', async ({ page }) => {
    await stubApply(page, { organisations: false });
    await page.goto('/northfield/programmes');
    await page.getByRole('link', { name: 'Read more and apply for Community Spaces Fund' }).click();
    await page.getByRole('link', { name: 'Start application' }).click();

    await expect(
      page.getByRole('heading', { level: 2, name: 'Add your organisation first' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Add your organisation' }).click();
    await expect(h1(page, 'Add your organisation')).toBeVisible();
  });
});

test.describe('applying', () => {
  test('starts an application, is stopped once and changes the answer, fills the form over two sittings, and submits', async ({
    page,
  }) => {
    const stub = await stubApply(page);
    await page.goto('/northfield/programmes');
    await page.getByRole('link', { name: 'Read more and apply for Community Spaces Fund' }).click();
    await page.getByRole('link', { name: 'Start application' }).click();

    // Who is applying: the only organisation is chosen already.
    await expect(h1(page, 'Who is applying?')).toBeVisible();
    await expect(page.getByRole('radio', { name: /Eastmere Community Garden/ })).toBeChecked();
    await page.getByRole('button', { name: 'Start application' }).click();
    await expect(h1(page, 'Your application')).toBeFocused();
    expect(stub.sent.find(({ key }) => key.startsWith('POST /portal/rounds'))?.body).toEqual({
      organisationId: '3c1b8d52-6f0a-4e0e-9f0b-7a6f2d1c4b55',
    });

    // Eligibility comes first, and the rest waits for it.
    await expect(page.getByText('Cannot start yet')).toHaveCount(3);
    await page.getByRole('link', { name: 'Continue with Check you can apply' }).click();
    await expect(h1(page, 'Check you can apply')).toBeFocused();
    await page.getByRole('radio', { name: 'No' }).check();
    const stop = page.getByRole('alert');
    await expect(
      stop.getByText('This programme is open to registered charities only.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save and continue' })).toHaveCount(0);
    await stop.getByRole('button', { name: 'Change your answer' }).click();
    await expect(page.getByRole('radio', { name: 'Yes' })).toBeFocused();
    await page.getByRole('radio', { name: 'Yes' }).check();
    await page.getByRole('button', { name: 'Save and continue' }).click();

    await expect(h1(page, 'Your application')).toBeFocused();
    await expect(page.getByText('Cannot start yet')).toHaveCount(0);
    expect(stub.applications[0]?.answers).toEqual(eligible);

    // The first sitting: part of one section, then leave.
    await page.getByRole('link', { name: 'Continue with About your organisation' }).click();
    await expect(h1(page, 'About your organisation')).toBeFocused();
    await expect(page).toHaveTitle(`Section 1 of 3: About your organisation ${SUFFIX}`);
    await expect(page.getByText('Section 1 of 3')).toBeVisible();
    await page
      .getByRole('textbox', { name: /^Organisation name/ })
      .fill('Eastmere Community Garden');
    await expect(page.getByRole('textbox', { name: /^Website address/ })).toHaveCount(0);
    await page
      .getByRole('group', { name: /Do you have a website/ })
      .getByRole('radio', { name: 'No' })
      .check();
    await expect(saved(page)).toBeVisible();
    await expect
      .poll(() => stub.applications[0]?.answers)
      .toMatchObject({
        f_name: 'Eastmere Community Garden',
      });
    await page.getByRole('button', { name: 'Save and come back later' }).click();
    await expect(h1(page, 'Your application')).toBeVisible();
    await expect(page.getByText('1 question to finish.')).toBeVisible();

    // The second sitting: a fresh page, and everything is where it was left.
    await page.goto('/northfield/applications');
    await page
      .getByRole('link', {
        name: 'Continue application for Community Spaces Fund, Spring 2027',
      })
      .click();
    await expect(
      page.getByRole('link', { name: 'Continue with About your organisation' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Continue with About your organisation' }).click();
    await expect(page.getByRole('textbox', { name: /^Organisation name/ })).toHaveValue(
      'Eastmere Community Garden',
    );
    await page.getByRole('button', { name: 'Save and continue' }).click();

    await expect(h1(page, 'Your project')).toBeFocused();
    await expect(page.getByText('Section 2 of 3')).toBeVisible();
    await page
      .getByRole('textbox', { name: /^Project summary/ })
      .fill('A weekly lunch for older people in the village hall.');
    await expect(page.getByText('You have 40 words left').first()).toBeVisible();
    await page.getByRole('button', { name: 'Save and continue' }).click();

    await expect(h1(page, 'Budget')).toBeFocused();
    await page.getByRole('button', { name: 'Add the first cost' }).click();
    await page.getByRole('textbox', { name: /^Item/ }).fill('Hall hire');
    await page.getByRole('textbox', { name: /^Cost/ }).fill('2880');
    await expect(page.getByText('£2,880')).toBeVisible();
    await page.getByRole('button', { name: 'Save and check your answers' }).click();

    // The check page lists what is missing, and offers nothing to submit.
    await expect(h1(page, 'Check your answers')).toBeFocused();
    const missing = page.getByRole('region', { name: 'Before you can send your application' });
    await expect(missing.getByRole('link')).toHaveText([
      'Contact email address: Enter an answer to this question.',
    ]);
    await expect(page.getByRole('button', { name: 'Submit application' })).toHaveCount(0);
    await expect(page.getByRole('row', { name: /Hall hire/ })).toContainText('£2,880');

    // The link goes straight to the question.
    await missing.getByRole('link').click();
    await expect(h1(page, 'About your organisation')).toBeVisible();
    await expect(page.getByRole('textbox', { name: /^Contact email address/ })).toBeFocused();
    await page
      .getByRole('textbox', { name: /^Contact email address/ })
      .fill('hello@eastmere.example');
    await page.getByRole('button', { name: 'Save and come back later' }).click();

    await expect(page.getByText('Completed', { exact: true })).toHaveCount(4);
    await page.getByRole('link', { name: 'Check your answers' }).first().click();
    await expect(h1(page, 'Check your answers')).toBeVisible();
    await expect(page.getByText('hello@eastmere.example')).toBeVisible();
    await page.getByRole('button', { name: 'Submit application' }).click();

    await expect(h1(page, 'Application submitted')).toBeFocused();
    await expect(page).toHaveTitle(`Application submitted ${SUFFIX}`);
    await expect(page.getByText('You do not need to do anything now.')).toBeVisible();
    await expect(page.getByText('Submitted', { exact: true })).toBeVisible();
    expect(stub.applications[0]?.status).toBe('submitted');
    expect(stub.sent.find(({ key }) => key.endsWith('/submit'))?.body).toEqual({
      basedOn: stub.applications[0]?.answersVersion,
    });
  });

  test('works from the keyboard alone', async ({ page }) => {
    const stub = await stubApply(page, { applications: [draft()] });
    await page.goto(`${home}/eligibility`);
    await expect(h1(page, 'Check you can apply')).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(page.getByRole('radio', { name: 'Yes' })).toBeFocused();
    await page.keyboard.press('Space');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Save and continue' })).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(h1(page, 'Your application')).toBeFocused();
    expect(stub.applications[0]?.answers).toEqual(eligible);
  });

  test('asks for an answer to the eligibility question before it carries on', async ({ page }) => {
    const stub = await stubApply(page, { applications: [draft()] });
    await page.goto(`${home}/eligibility`);

    await page.getByRole('button', { name: 'Save and continue' }).click();

    const summary = page.getByRole('alert', { name: 'There is a problem' });
    await expect(summary).toBeFocused();
    await summary.getByRole('link', { name: 'Choose an answer to this question.' }).click();
    await expect(page.getByRole('radio', { name: 'Yes' })).toBeFocused();
    expect(stub.sent.some(({ key }) => key.includes('eligibility-check'))).toBe(false);
  });

  test('keeps a section from an applicant who has not checked they can apply', async ({ page }) => {
    await stubApply(page, { applications: [draft()] });
    await page.goto(`${home}/sections/s_project`);

    await expect(h1(page, 'Your project')).toBeVisible();
    await expect(
      page.getByText('Check you can apply before you start this section.'),
    ).toBeVisible();
    await expect(page.getByRole('textbox')).toHaveCount(0);
  });

  test('says an application that is not theirs cannot be found', async ({ page }) => {
    await stubApply(page, {
      more: { [`GET /portal/applications/${APPLICATION_ID}`]: problem(404, 'Not found.') },
    });
    await page.goto(home);

    await expect(
      page.getByText('We cannot find this application. It may belong to someone else.'),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Go to your applications' }).click();
    await expect(h1(page, 'Your applications')).toBeVisible();
  });
});

test.describe('answers that are not lost', () => {
  const about = `${home}/sections/s_about`;
  const name = (page: Page) => page.getByRole('textbox', { name: /^Organisation name/ });

  test('keeps the answers on screen when a save fails, and saves them by itself later', async ({
    page,
  }) => {
    const stub = await stubApply(page, { applications: [draft({ answers: eligible })] });
    stub.failSaves(1);
    await page.goto(about);
    await expect(h1(page, 'About your organisation')).toBeVisible();

    await name(page).fill('Eastmere Community Garden');

    await expect(page.getByText('Not saved. Check your connection and try again')).toBeVisible();
    await expect(name(page)).toHaveValue('Eastmere Community Garden');
    expect(stub.applications[0]?.answers).toEqual(eligible);

    await expect(saved(page)).toBeVisible({ timeout: 15_000 });
    expect(stub.applications[0]?.answers).toMatchObject({ f_name: 'Eastmere Community Garden' });
  });

  test('saves again when the applicant asks', async ({ page }) => {
    const stub = await stubApply(page, { applications: [draft({ answers: eligible })] });
    stub.failSaves(1);
    await page.goto(about);

    await name(page).fill('Eastmere');
    await page.getByRole('button', { name: 'Try saving again' }).click();

    await expect(saved(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try saving again' })).toHaveCount(0);
    expect(stub.applications[0]?.answers).toMatchObject({ f_name: 'Eastmere' });
  });

  test('offers the latest answers when they were saved somewhere else, and does not overwrite them', async ({
    page,
  }) => {
    const stub = await stubApply(page, { applications: [draft({ answers: eligible })] });
    await page.goto(about);
    await expect(h1(page, 'About your organisation')).toBeVisible();
    const [application] = stub.applications;
    if (application === undefined) throw new Error('The stub has no application.');
    application.answers = { ...eligible, f_name: 'Saved in another window' };
    application.answersVersion = 4;

    await name(page).fill('Typed here');

    const alert = page.getByRole('alert');
    await expect(alert.getByText('Your answers were saved somewhere else')).toBeVisible();
    expect(application.answers['f_name']).toBe('Saved in another window');
    await alert.getByRole('button', { name: 'Show the latest saved answers' }).click();

    await expect(name(page)).toHaveValue('Saved in another window');
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('asks before leaving answers it could not save', async ({ page }) => {
    const stub = await stubApply(page, { applications: [draft({ answers: eligible })] });
    stub.failSaves(3);
    await page.goto(about);
    await name(page).fill('Eastmere Community Garden');
    await expect(page.getByText(/^Not saved/)).toBeVisible();

    await page
      .getByRole('navigation', { name: 'Breadcrumb' })
      .getByRole('link', { name: 'Community Spaces Fund, Spring 2027' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Leave this page?' });
    await expect(
      dialog.getByText(
        'Some of your answers are not saved. If you leave this page, you may lose them.',
      ),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Stay on this page' }).click();
    await expect(name(page)).toHaveValue('Eastmere Community Garden');
  });
});

test.describe('a session that ends while an applicant is typing', () => {
  // The page's clock starts at START and then runs at the speed of the real one, plus
  // whatever the spec has made it skip.
  const START = new Date('2026-10-05T09:00:00Z');
  let installedAt = 0;
  let skipped = 0;
  const inMinutes = (minutes: number) =>
    new Date(
      START.getTime() + (Date.now() - installedAt) + skipped + minutes * 60_000,
    ).toISOString();

  test.beforeEach(async ({ page }) => {
    installedAt = Date.now();
    skipped = 0;
    await page.clock.install({ time: START });
  });

  test('keeps what was typed, puts it back after they sign in, and saves it', async ({ page }) => {
    let expired = false;
    const stub = await stubApply(page, {
      applications: [draft({ answers: eligible })],
      more: {
        'GET /auth/session': () =>
          expired
            ? signedOut
            : { status: 200, body: applicantSession({ expiresAt: inMinutes(60) }) },
        'POST /auth/tenants/northfield/sign-in': () => {
          expired = false;
          return { status: 200, body: applicantSession({ expiresAt: inMinutes(60) }) };
        },
      },
    });
    stub.failSaves(1000);
    await page.goto(`${home}/sections/s_about`);
    await page.getByRole('textbox', { name: /^Organisation name/ }).fill('Augusta Community Hall');
    await expect(page.getByText(/^Not saved/)).toBeVisible();

    expired = true;
    await page.clock.fastForward('58:00');
    await expect(page.getByRole('dialog', { name: 'You will be signed out soon' })).toBeVisible();
    await page.clock.runFor('02:05');
    skipped = (58 * 60 + 2 * 60 + 5) * 1000;

    await expect(h1(page, 'Sign in')).toBeVisible();
    await expect(page).toHaveURL(/\/northfield\/sign-in\?next=.*sections.*notice=timeout$/);
    stub.failSaves(0);
    await page.getByRole('textbox', { name: 'Email address' }).fill('ada@example.org');
    await page.getByLabel('Password', { exact: true }).fill('correct horse battery');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(h1(page, 'About your organisation')).toBeVisible();
    await expect(page.getByRole('textbox', { name: /^Organisation name/ })).toHaveValue(
      'Augusta Community Hall',
    );
    await expect(
      page.getByText('We kept what you typed last time. We are saving it now.'),
    ).toBeVisible();
    await expect(saved(page)).toBeVisible();
    expect(stub.applications[0]?.answers).toMatchObject({ f_name: 'Augusta Community Hall' });
  });
});

test.describe('your applications', () => {
  test('lists what to finish and what was sent, and withdraws a sent application once confirmed', async ({
    page,
  }) => {
    const stub = await stubApply(page, {
      applications: [draft({ answers: eligible }), sent()],
    });
    await page.goto('/northfield/applications');

    await expect(h1(page, 'Your applications')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(['To finish', 'Sent']);
    await page
      .getByRole('button', { name: 'Withdraw application for Community Spaces Fund, Spring 2027' })
      .click();

    const dialog = page.getByRole('dialog', { name: 'Withdraw this application?' });
    await expect(dialog.getByText(/You cannot undo this\./)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Keep my application' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Keep my application' }).click();
    await expect(dialog).toHaveCount(0);
    expect(stub.applications[1]?.status).toBe('submitted');

    await page
      .getByRole('button', { name: 'Withdraw application for Community Spaces Fund, Spring 2027' })
      .click();
    await page.getByRole('dialog').getByRole('button', { name: 'Withdraw application' }).click();

    const notice = page.getByText(
      'Your application to Community Spaces Fund, Spring 2027 is withdrawn.',
    );
    await expect(notice).toBeFocused();
    await expect(page.getByText('Withdrawn', { exact: true })).toBeVisible();
    expect(stub.applications.find(({ id }) => id === SENT_APPLICATION_ID)?.status).toBe(
      'withdrawn',
    );
  });

  test('shows a sent application’s status and what happens next, and nothing from inside the funder', async ({
    page,
  }) => {
    await stubApply(page, { applications: [sent({ status: 'under_review' })] });
    await page.goto(`/northfield/applications/${SENT_APPLICATION_ID}/submitted`);

    await expect(h1(page, 'Application submitted')).toBeVisible();
    await expect(page.getByText('Under review', { exact: true })).toBeVisible();
    await expect(page.getByRole('main')).not.toContainText(/score|stage|reviewer|shortlist/i);
  });

  test('cannot change an application that has been sent', async ({ page }) => {
    await stubApply(page, { applications: [draft({ ...sent(), id: APPLICATION_ID })] });
    await page.goto(`${home}/sections/s_about`);

    await expect(
      page.getByText(
        'You cannot change this application, because you have sent it or withdrawn it.',
      ),
    ).toBeVisible();
    await expect(page.getByRole('textbox')).toHaveCount(0);
  });

  test('submits only from a complete application', async ({ page }) => {
    await stubApply(page, { applications: [draft({ answers: completeAnswers })] });
    await page.goto(`${home}/check`);

    await expect(page.getByRole('button', { name: 'Submit application' })).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Before you can send your application' }),
    ).toHaveCount(0);
  });
});
