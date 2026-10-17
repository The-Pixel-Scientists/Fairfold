// SPDX-License-Identifier: AGPL-3.0-or-later
//
// An applicant reading where their application stands: before the funder
// releases a decision only "Submitted" or "Under review", and after it the
// outcome, in a real browser, with the API's answers stubbed (apply-api.ts).
// The same journey runs against the real API in outcome-journey.spec.ts.

import type { Page } from '@playwright/test';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import { SENT_APPLICATION_ID, sent, stubApply } from './apply-api.ts';
import type { Application, Outcome } from './apply-api.ts';

const SUFFIX = '– Fairfold Grants';
const NAME = 'Community Spaces Fund, Spring 2027';
const home = `/northfield/applications/${SENT_APPLICATION_ID}`;

const award: Outcome = { result: 'accepted', amount: { amountMinor: 1_250_000, currency: 'GBP' } };

const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });
const main = (page: Page) => page.getByRole('main');

/** Words that give an outcome away, and words from inside the funder. Neither may show before release. */
const OUTCOME_WORDS = /awarded|waiting list|not funded|successful|congratulations|£\d/i;
const INSIDE_WORDS = /score|stage|reviewer|shortlist|rank/i;

/** What the application holds once its decision is released. */
const released = (status: Application['status'], outcome: Outcome): Partial<Application> => ({
  status,
  outcome,
});

test.describe('before a decision is released', () => {
  for (const status of ['submitted', 'under_review'] as const) {
    test(`shows ${status === 'submitted' ? 'Submitted' : 'Under review'} and nothing that suggests an outcome`, async ({
      page,
    }) => {
      await stubApply(page, { applications: [sent({ status })] });

      await page.goto('/northfield/applications');
      await expect(h1(page, 'Your applications')).toBeVisible();
      await expect(
        page.getByText(status === 'submitted' ? 'Submitted' : 'Under review', { exact: true }),
      ).toBeVisible();
      await expect(page.getByRole('link', { name: /^Read your outcome/ })).toHaveCount(0);
      await expect(main(page)).not.toContainText(OUTCOME_WORDS);
      await expect(main(page)).not.toContainText(INSIDE_WORDS);

      await page.goto(home);
      await expect(page.getByText('Status')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Read your outcome' })).toHaveCount(0);
      await expect(main(page)).not.toContainText(OUTCOME_WORDS);
    });

    test(`gives only the status at the address of the outcome while ${status === 'submitted' ? 'submitted' : 'under review'}`, async ({
      page,
    }) => {
      await stubApply(page, { applications: [sent({ status })] });
      await page.goto(`${home}/outcome`);

      await expect(h1(page, 'Your application')).toBeVisible();
      await expect(main(page)).toContainText(
        `${NAME}: ${status === 'submitted' ? 'Submitted' : 'Under review'}.`,
      );
      await expect(main(page)).not.toContainText(OUTCOME_WORDS);
      await expect(main(page)).not.toContainText(INSIDE_WORDS);
      await expect(page.getByRole('heading', { level: 2 })).toHaveCount(0);
    });
  }
});

test.describe('after a decision is released', () => {
  test('shows the award and its amount in the list, then says what happens next', async ({
    page,
  }) => {
    await stubApply(page, { applications: [sent(released('awarded', award))] });
    await page.goto('/northfield/applications');

    const card = page.getByRole('listitem').filter({ hasText: 'Spring 2027' });
    await expect(card.getByText('Awarded', { exact: true })).toBeVisible();
    await expect(card.getByText('£12,500')).toBeVisible();
    await card.getByRole('link', { name: `Read your outcome for ${NAME}` }).click();

    await expect(h1(page, 'Your application was successful')).toBeFocused();
    await expect(page).toHaveTitle(`Your outcome ${SUFFIX}`);
    await expect(main(page)).toContainText('You have been awarded £12,500');
    await expect(page.getByRole('heading', { level: 2, name: 'What happens next' })).toBeVisible();
    await expect(main(page)).not.toContainText(INSIDE_WORDS);

    await page.getByRole('link', { name: 'Back to your applications' }).click();
    await expect(h1(page, 'Your applications')).toBeVisible();
  });

  test('says a place on the waiting list plainly, with no amount', async ({ page }) => {
    await stubApply(page, {
      applications: [sent(released('waitlisted', { result: 'waitlisted' }))],
    });
    await page.goto(home);
    await page.getByRole('link', { name: 'Read your outcome' }).click();

    await expect(h1(page, 'You are on our waiting list')).toBeVisible();
    await expect(page.getByText('We cannot offer you a grant yet.')).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: 'What the waiting list means' }),
    ).toBeVisible();
    await expect(main(page)).not.toContainText(/£\d/);
    await expect(main(page)).not.toContainText(INSIDE_WORDS);
  });

  test('says a decision not to fund kindly, and what the applicant can do next', async ({
    page,
  }) => {
    await stubApply(page, { applications: [sent(released('not_funded', { result: 'declined' }))] });
    await page.goto(`${home}/outcome`);

    await expect(h1(page, 'We could not fund your application')).toBeVisible();
    await expect(
      page.getByText('Thank you for applying. We know this is not the news you hoped for.'),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: 'What you can do next' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'See programmes you can apply to' }).click();
    await expect(h1(page, 'Programmes you can apply to')).toBeVisible();
    await expect(main(page)).not.toContainText(INSIDE_WORDS);
  });

  test('shows the outcome on a later visit, when the decision is released in between', async ({
    page,
  }) => {
    const stub = await stubApply(page, { applications: [sent({ status: 'under_review' })] });
    await page.goto('/northfield/applications');
    await expect(page.getByText('Under review', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Read your outcome/ })).toHaveCount(0);

    const [application] = stub.applications;
    if (application === undefined) throw new Error('The stub has no application.');
    Object.assign(application, released('awarded', award));
    await page.reload();

    await expect(page.getByText('Awarded', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: `Read your outcome for ${NAME}` }).click();
    await expect(main(page)).toContainText('You have been awarded £12,500');
  });
});
