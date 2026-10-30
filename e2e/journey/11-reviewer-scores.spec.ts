// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Demo step 11: a reviewer scores beside the application, by keyboard, with
// autosave. Identity fields and every file are hidden, and the budget table
// shows. The rest of the reviews are scored and submitted, and the manager
// sees the spread of scores, with the widest first.

import {
  openReview,
  readTheSpread,
  reviewRows,
  scoreFromTheKeyboard,
  submitReview,
} from '../../apps/console/e2e/assessment-steps.ts';
import { signInStaff, type Api } from '../support/api.ts';
import { groups } from '../support/applications.ts';
import { auditEvents } from '../support/audit.ts';
import { axePages } from '../support/axe.ts';
import { need, readState, updateState } from '../support/state.ts';
import { expect, h1, inOrder, test } from '../support/test.ts';

inOrder();

interface Review {
  id: string;
  applicationId: string;
  status: string;
}

interface Criterion {
  id: string;
}

const reviewsOf = async (api: Api): Promise<Review[]> =>
  (await api.ok<{ reviews: Review[] }>('GET', '/console/reviews')).reviews;

/** Scores every criterion of a review and submits it, as the reviewer does at the keyboard. */
async function scoreAndSubmit(api: Api, assignmentId: string, score: number): Promise<void> {
  const { criteria } = await api.ok<{ criteria: Criterion[] }>(
    'GET',
    `/console/reviews/${assignmentId}`,
  );
  const scores = criteria.map(({ id }) => ({ criterionId: id, score, comment: '' }));
  await api.ok('PUT', `/console/reviews/${assignmentId}/scores`, { json: { scores } });
  await api.ok('POST', `/console/reviews/${assignmentId}/submit`, { json: { scores } });
}

/** What a blind reviewer must never be sent: whose application it is, how to reach them, or any file. */
function giveaways(): string[] {
  const state = readState();
  return [
    'Eastmere Community Garden',
    ...groups.map(({ organisation }) => organisation),
    ...Object.values(state.people).map(({ email }) => email),
    'hello@',
    'accounts-2026',
    need('accountsFileId'),
  ];
}

test.describe('step 11: reviewers score blind', () => {
  test('a reviewer sees the application without who it is from or any file, and the budget table', async ({
    pages,
  }) => {
    const api = await signInStaff('northfield', 'reviewer1');
    const [first] = await reviewsOf(api);
    const text = (await api.send('GET', `/console/reviews/${first?.id ?? ''}`)).text;
    for (const giveaway of giveaways()) expect(text, giveaway).not.toContain(giveaway);
    expect(text).toContain('Staff time');
    await api.dispose();

    const page = await pages.staff('reviewer1');
    await page.goto('/northfield/reviews');
    await openReview(page, 0);
    const body = page.getByRole('main');
    const budget = body.getByRole('table', { name: 'What will it cost?' });
    await expect(budget).toBeVisible();
    await expect(budget).toContainText('Staff time');
    await expect(budget).toContainText('£');
    for (const giveaway of giveaways()) await expect(body, giveaway).not.toContainText(giveaway);
    await expect(body.getByRole('link', { name: /^Download/ })).toHaveCount(0);
    await expect(body.getByText('Contact email')).toHaveCount(0);
  });

  test('scores by keyboard with autosave, keeps the scores after a reload, and submits', async ({
    pages,
  }) => {
    const page = await pages.staff('reviewer1');
    await page.goto('/northfield/reviews');
    await openReview(page, 0);
    await scoreFromTheKeyboard(page, [5, 4, 3]);

    await page.reload();
    const panel = page.getByRole('region', { name: 'Your review' });
    await expect(panel.getByRole('radiogroup')).toHaveCount(3);
    await expect(
      panel.getByRole('radiogroup').nth(0).getByRole('radio', { name: '5' }),
    ).toBeChecked();
    await expect(
      panel.getByRole('radiogroup').nth(2).getByRole('radio', { name: '3' }),
    ).toBeChecked();
    await submitReview(page);
    await page.getByRole('link', { name: 'Back to My reviews' }).click();
    await expect(h1(page, 'My reviews')).toBeVisible();
    await expect(reviewRows(page).filter({ hasText: 'Submitted' })).toHaveCount(1);
  });

  test('the other reviews are scored: the first application splits its two reviewers wide apart', async () => {
    const one = await signInStaff('northfield', 'reviewer1');
    const two = await signInStaff('northfield', 'reviewer2');
    const mine = await reviewsOf(one);
    const theirs = await reviewsOf(two);
    expect(mine).toHaveLength(4);
    expect(theirs).toHaveLength(5);
    const scored = mine.find(({ status }) => status === 'submitted');
    expect(scored).toBeDefined();

    for (const review of mine.filter(({ status }) => status !== 'submitted')) {
      await scoreAndSubmit(one, review.id, 4);
    }
    for (const review of theirs) {
      await scoreAndSubmit(two, review.id, review.applicationId === scored?.applicationId ? 1 : 4);
    }
    updateState((state) => {
      state.lists['reviewer1AssignmentIds'] = mine.map(({ id }) => id);
      state.lists['reviewer2AssignmentIds'] = theirs.map(({ id }) => id);
      state.ids['wideApplicationId'] = scored?.applicationId ?? '';
    });
    expect((await reviewsOf(one)).every(({ status }) => status === 'submitted')).toBe(true);
    await one.dispose();
    await two.dispose();
  });

  test('the manager sees the spread of scores, the widest first, and the reviews are audited', async ({
    pages,
  }) => {
    const page = await pages.staff('manager');
    await readTheSpread(page, need('roundId'));
    const submitted = await auditEvents((await pages.staff('admin')).request, {
      action: 'grants.review.submitted',
    });
    expect(submitted).toHaveLength(9);
  });

  test('@a11y the review and the spread have no axe violations', async ({ pages }) => {
    const api = await signInStaff('northfield', 'reviewer2');
    const [first] = await reviewsOf(api);
    await api.dispose();
    await axePages(await pages.staff('reviewer2'), [`/northfield/reviews/${first?.id ?? ''}`]);
    await axePages(await pages.staff('manager'), [
      `/northfield/rounds/${need('roundId')}/score-spread`,
    ]);
  });
});
