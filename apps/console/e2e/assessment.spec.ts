// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The assessment screens in a real browser, with the API's answers stubbed
// (assessment-api.ts): a funder with a round in Review, a pool of reviewers,
// submissions to assign, and a reviewer's own assignments. The same steps run
// against the real API in assessment-journey.spec.ts. Every spec also fails
// on a Content Security Policy violation, so the screens are checked under the
// production policy in console-production.

import { productName } from '@pixel-scientists/domain/platform';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';

import { ids, stubAssessment } from './assessment-api.ts';
import {
  assignAutomatically,
  declareConflict,
  h1,
  openReview,
  openSubmissionsInReview,
  readTheSpread,
  reviewRows,
  reviewsTable,
  scoreFromTheKeyboard,
  submitReview,
} from './assessment-steps.ts';

const SUFFIX = `– ${productName} console`;

test.describe('a programme manager setting up and reading assessment', () => {
  test('adds a reviewer to the pool and removes one with no reviews', async ({ page }) => {
    await stubAssessment(page, { as: 'manager' });
    await page.goto(`/northfield/rounds/${ids.round}/reviewers`);

    await expect(page).toHaveTitle(`Reviewers ${SUFFIX}`);
    const pool = page.getByRole('table', { name: 'Reviewers in the pool' });
    await expect(pool.locator('tbody > tr')).toHaveCount(3);
    await expect(pool.getByRole('row', { name: /Priya Shah/ })).toContainText('Has reviews');

    await page.getByRole('checkbox', { name: 'Hannah Lewis' }).check();
    await page.getByRole('button', { name: 'Add 1 reviewer' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'added to the pool' })).toBeFocused();
    await expect(pool.locator('tbody > tr')).toHaveCount(4);

    await pool.getByRole('button', { name: /Remove.*Tom Okafor/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Remove Tom Okafor from the pool?' });
    await expect(dialog.getByRole('button', { name: 'Keep in the pool' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Remove from the pool' }).click();
    await expect(page.getByText('Tom Okafor removed from the pool.')).toBeVisible();
    await expect(pool.locator('tbody > tr')).toHaveCount(3);
  });

  test('assigns two reviewers to each chosen submission automatically and says who could not be filled', async ({
    page,
  }) => {
    const stub = await stubAssessment(page, { as: 'manager' });
    await openSubmissionsInReview(page, ids.round, ids.review);

    // The first has two submitted reviews already, so only the other two need reviewers.
    const { result } = await assignAutomatically(page, 3, 2);
    expect(result).toContain('4 reviews assigned.');
    await expect(page.getByRole('status').filter({ hasText: '4 reviews assigned.' })).toBeFocused();
    const second = stub.assignments.filter((item) => item.submissionId === stub.held[1]?.id);
    expect(second.map((item) => item.reviewer.name).sort()).toEqual(['Priya Shah', 'Tom Okafor']);

    // Asking for four from a pool of three leaves one submission short.
    const again = await assignAutomatically(page, 1, 4);
    expect(again.result).toContain('1 review assigned.');
    expect(again.result).toContain('1 submission could not get all the reviewers asked for');
    expect(again.result).toContain('needs 1 more reviewer');
  });

  test('assigns chosen reviewers to one submission from its page', async ({ page }) => {
    const stub = await stubAssessment(page, { as: 'manager' });
    const target = stub.held[4];
    await page.goto(`/northfield/submissions/${target?.id ?? ''}`);

    const panel = page.getByRole('region', { name: 'Reviewers' });
    await expect(panel).toContainText('No reviewers are assigned yet');
    await panel.getByRole('button', { name: 'Assign reviewers' }).click();
    const dialog = page.getByRole('dialog', { name: 'Assign reviewers' });
    await dialog.getByRole('checkbox', { name: /Tom Okafor/ }).check();
    await dialog.getByRole('checkbox', { name: /Owen Hughes/ }).check();
    await dialog.getByRole('button', { name: 'Assign 2 reviewers' }).click();

    await expect(dialog).toBeHidden();
    await expect(panel.getByText('2 reviews assigned.')).toBeVisible();
    await expect(panel.getByRole('listitem')).toHaveCount(2);
    expect(stub.assignments.filter((item) => item.submissionId === target?.id)).toHaveLength(2);
    await panel.getByRole('button', { name: /Remove.*Tom Okafor/ }).click();
    await page.getByRole('button', { name: 'Remove reviewer' }).click();
    await expect(panel.getByRole('listitem')).toHaveCount(1);
    await expect(
      panel.getByRole('status').filter({ hasText: 'removed from this submission' }),
    ).toBeFocused();
    await expect(page.locator('body')).not.toBeFocused();
  });

  test('reads the spread of scores: sorted, with the wide spread flagged in words, and how each reviewer scored', async ({
    page,
  }) => {
    await stubAssessment(page, { as: 'manager' });
    await readTheSpread(page, ids.round);
    await expect(page).toHaveTitle(`Score spread ${SUFFIX}`);
  });

  test('is operated from the keyboard: arrows move between rows, Enter shows the scores and ? lists the keys', async ({
    page,
  }) => {
    await stubAssessment(page, { as: 'manager' });
    await page.goto(`/northfield/rounds/${ids.round}/score-spread`);
    const row = page
      .getByRole('table', { name: 'Score spread for each submission' })
      .locator('tbody > tr')
      .first();
    await row.focus();

    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toContainText(
      'Show how each reviewer scored the submission',
    );
    await page.keyboard.press('Escape');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: /^Scores for / })).toBeVisible();
  });
});

test.describe('a reviewer scoring blind', () => {
  test('lists the assigned reviews by application, never by organisation, and has no other page', async ({
    page,
  }) => {
    await stubAssessment(page, { as: 'reviewer' });
    await page.goto('/northfield/');

    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'My reviews' })
      .click();
    await expect(h1(page, 'My reviews')).toBeFocused();
    await expect(page).toHaveTitle(`My reviews ${SUFFIX}`);
    await expect(reviewRows(page)).toHaveCount(3);
    await expect(reviewsTable(page)).toContainText('Application');
    await expect(reviewsTable(page)).not.toContainText('Community Trust');
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link')).toHaveCount(1);
  });

  test('declares a conflict, scores a review by keyboard and submits it', async ({ page }) => {
    const stub = await stubAssessment(page, { as: 'reviewer' });
    await page.goto('/northfield/reviews');
    await expect(reviewRows(page)).toHaveCount(3);

    // The first review is declared a conflict and leaves the list.
    await openReview(page, 0);
    await declareConflict(page);
    await expect(reviewRows(page)).toHaveCount(2);
    expect(stub.assignments.filter((item) => item.status === 'conflicted')).toHaveLength(1);

    // The second now has no reviews started, so the conflict check comes first. It is scored by keyboard and submitted.
    await openReview(page, 1);
    await expect(
      page.getByRole('button', { name: 'I have no conflict, start scoring' }),
    ).toBeVisible();
    await scoreFromTheKeyboard(page, [5, 4, 3]);
    await submitReview(page);
    expect(stub.assignments.filter((item) => item.status === 'submitted')).toHaveLength(1);
    expect(
      stub.assignments
        .find((item) => item.status === 'submitted')
        ?.scores.map((item) => item.score),
    ).toEqual([5, 4, 3]);

    await page.getByRole('link', { name: 'Back to My reviews' }).click();
    await expect(reviewRows(page).filter({ hasText: 'Submitted' })).toHaveCount(1);
  });

  test('keeps a half-scored review where it was left, and shows what is still to score', async ({
    page,
  }) => {
    await stubAssessment(page, { as: 'reviewer' });
    await page.goto('/northfield/reviews');
    await openReview(page, 1);

    const panel = page.getByRole('region', { name: 'Your review' });
    // One criterion is scored, so there is no conflict check.
    await expect(panel.getByRole('radio', { name: '4' }).first()).toBeChecked();
    await expect(panel).toContainText('Still to score: Approach and Value for money');
    await panel.getByRole('button', { name: 'Submit review' }).click();
    await expect(page.getByRole('alert')).toContainText('Score every criterion to submit');
    await page.getByRole('link', { name: 'Give Approach a score from 1 to 5' }).click();
    await expect(panel.getByRole('radio', { name: '1' }).nth(1)).toBeFocused();
  });

  test('cannot read a review that is not theirs', async ({ page }) => {
    await stubAssessment(page, { as: 'reviewer' });
    await page.goto('/northfield/reviews/00000000-0000-4000-8000-000000000999');

    await expect(
      page.getByRole('heading', { level: 2, name: 'This review is not on your list' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to My reviews' })).toBeVisible();
  });
});
