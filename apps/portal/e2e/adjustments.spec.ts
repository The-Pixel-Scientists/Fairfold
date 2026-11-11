// SPDX-License-Identifier: AGPL-3.0-or-later
//
// An applicant with more time than the round, and an applicant whose funder sent
// the application for them, in a real browser, with the API's answers stubbed
// (apply-api.ts). The portal shows the closing time the API sends and never
// decides lateness itself.

import type { Page } from '@playwright/test';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import { APPLICATION_ID, completeAnswers, draft, sent, stubApply } from './apply-api.ts';

const home = `/northfield/applications/${APPLICATION_ID}`;
const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });
const MORE_TIME = '2026-12-15T17:00';

test.describe('an extended deadline', () => {
  test('keeps the application open after the round’s own closing time: it saves and submits', async ({
    page,
  }) => {
    const stub = await stubApply(page, {
      applications: [draft({ closesAt: MORE_TIME, answers: { f_charity: true } })],
    });
    await page.goto(home);

    await expect(
      page.getByText(
        'You have more time to apply. Your deadline is 5pm on 15 December 2026, UK time.',
      ),
    ).toBeVisible();
    await expect(page.getByRole('main')).not.toContainText('2 November');

    await page.goto(`${home}/sections/s_project`);
    await page.getByRole('textbox', { name: /^Project summary/ }).fill('A weekly lunch.');
    await expect(page.getByText(/^Saved at \d/)).toBeVisible();
    expect(
      stub.sent.some(({ key }) => key === `PUT /portal/applications/${APPLICATION_ID}/answers`),
    ).toBe(true);

    const [saved] = stub.applications;
    if (saved === undefined) throw new Error('The application is missing.');
    saved.answers = completeAnswers;
    saved.answersVersion += 1;
    await page.goto(`${home}/check`);
    await expect(
      page.getByText('Your deadline is 5pm on 15 December 2026, UK time.'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Submit application' }).click();

    await expect(h1(page, 'Application submitted')).toBeVisible();
  });

  test('shows the server’s problem text when it refuses after the closing time', async ({
    page,
  }) => {
    await stubApply(page, {
      applications: [draft({ closesAt: MORE_TIME, answers: completeAnswers })],
      more: {
        [`POST /portal/applications/${APPLICATION_ID}/submit`]: {
          status: 422,
          body: {
            type: 'about:blank',
            title: 'Problem',
            status: 422,
            detail: 'This application closed on 15 December 2026.',
            requestId: 'req_test',
          },
        },
      },
    });
    await page.goto(`${home}/check`);
    await page.getByRole('button', { name: 'Submit application' }).click();

    await expect(page.getByRole('alert')).toContainText(
      'This application closed on 15 December 2026.',
    );
  });

  test('shows the applicant’s own deadline in Your applications', async ({ page }) => {
    await stubApply(page, { applications: [draft({ closesAt: MORE_TIME })] });
    await page.goto('/northfield/applications');

    await expect(page.getByText('Your deadline')).toBeVisible();
    await expect(page.getByText('5pm on 15 December 2026, UK time')).toBeVisible();
    await expect(page.getByRole('main')).not.toContainText('2 November');
  });
});

test.describe('an application the funder sent', () => {
  test('says so, and reads back exactly what was sent', async ({ page }) => {
    await stubApply(page, {
      applications: [sent({ id: APPLICATION_ID, submissionRoute: 'assisted' })],
    });
    await page.goto(home);

    await expect(
      page.getByRole('heading', { level: 2, name: 'The funder sent this application for you' }),
    ).toBeVisible();
    await expect(page.getByText(/It was sent on 21 October 2026 at 1pm, UK time\./)).toBeVisible();

    await page.getByRole('link', { name: 'See what was sent' }).click();
    await expect(h1(page, 'What was sent')).toBeFocused();
    await expect(page.getByText('Eastmere Community Garden').first()).toBeVisible();
    await expect(
      page.getByText('A weekly lunch for older people in the village hall.'),
    ).toBeVisible();
    await expect(page.getByRole('textbox')).toHaveCount(0);
  });

  test('shows no such panel for an application the applicant sent', async ({ page }) => {
    await stubApply(page, { applications: [sent({ id: APPLICATION_ID })] });
    await page.goto(home);

    await expect(page.getByRole('link', { name: 'See your application' })).toBeVisible();
    await expect(page.getByText(/sent this application for you/)).toHaveCount(0);
  });
});
