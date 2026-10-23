// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Demo step 10: the manager sets up the reviewer pool and has two reviewers
// assigned to each application in Review. One reviewer declares a conflict;
// that assignment goes, and the change is audited.

import {
  assignAutomatically,
  declareConflict,
  openReview,
  openSubmissionsInReview,
  reviewRows,
} from '../../apps/console/e2e/assessment-steps.ts';
import { submissionRows } from '../../apps/console/e2e/submissions-steps.ts';
import type { Page } from '@playwright/test';

import { auditEvents } from '../support/audit.ts';
import { axePages } from '../support/axe.ts';
import { need } from '../support/state.ts';
import { expect, h1, inOrder, test } from '../support/test.ts';

inOrder();

const count = async (admin: Page, action: string): Promise<number> =>
  (await auditEvents(admin.request, { action })).length;

test.describe('step 10: reviewers are in the pool and assigned', () => {
  test('adds both reviewers to the round’s pool', async ({ pages }) => {
    const admin = await pages.staff('admin');
    const added = await count(admin, 'grants.reviewer.added');

    const page = await pages.staff('manager');
    await page.goto(`/northfield/rounds/${need('roundId')}/reviewers`);
    await expect(h1(page, 'Reviewers')).toBeVisible();
    await page.getByRole('checkbox', { name: 'Owen Hughes' }).check();
    await page.getByRole('checkbox', { name: 'Priya Shah' }).check();
    await page.getByRole('button', { name: 'Add 2 reviewers' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'added to the pool' })).toBeFocused();
    const pool = page.getByRole('table', { name: 'Reviewers in the pool' });
    await expect(pool.locator('tbody > tr')).toHaveCount(2);
    await expect(pool).toContainText('Owen Hughes');
    await expect(pool).toContainText('Priya Shah');

    expect((await count(admin, 'grants.reviewer.added')) - added).toBe(2);
  });

  test('assigns two reviewers to each of the five submissions in Review', async ({ pages }) => {
    const admin = await pages.staff('admin');
    const created = await count(admin, 'grants.assignment.created');

    const page = await pages.staff('manager');
    await openSubmissionsInReview(page, need('roundId'), need('reviewStageId'));
    await expect(submissionRows(page)).toHaveCount(5);
    const { result } = await assignAutomatically(page, 5, 2);
    expect(result).toMatch(/^10 reviews assigned\./);

    expect((await count(admin, 'grants.assignment.created')) - created).toBe(10);
  });

  test('a reviewer declares a conflict, which removes that assignment and is audited', async ({
    pages,
  }) => {
    const admin = await pages.staff('admin');
    const declared = await count(admin, 'grants.assignment.conflict_declared');

    const page = await pages.staff('reviewer1');
    await page.goto('/northfield/reviews');
    await expect(h1(page, 'My reviews')).toBeVisible();
    await expect(reviewRows(page)).toHaveCount(5);
    await openReview(page, 0);
    await declareConflict(page);
    await expect(reviewRows(page)).toHaveCount(4);

    const events = await auditEvents(admin.request, {
      action: 'grants.assignment.conflict_declared',
    });
    expect(events.length - declared).toBe(1);
    expect(events[0]?.actor.kind).toBe('staff');
  });

  test('@a11y the reviewer pool and the reviewer’s list have no axe violations', async ({
    pages,
  }) => {
    await axePages(await pages.staff('manager'), [
      `/northfield/rounds/${need('roundId')}/reviewers`,
    ]);
    await axePages(await pages.staff('reviewer1'), ['/northfield/reviews']);
  });
});
