// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Demo step 9: the manager filters the submissions by round and status, opens
// one (its answers with the budget table and its total, the accounts to
// download, the eligibility result and the history) and moves five to Review
// in bulk. The accounts download as an attachment the browser may not sniff,
// and the download is in the audit log.

import { readFile } from 'node:fs/promises';

import {
  filterByRoundAndStatus,
  moveFiveToReview,
  openOneAndReturn,
  openSubmissions,
  submissionRows,
} from '../../apps/console/e2e/submissions-steps.ts';
import { auditEvents } from '../support/audit.ts';
import { axePages } from '../support/axe.ts';
import { need, needList, updateState } from '../support/state.ts';
import { expect, h1, inOrder, test } from '../support/test.ts';

inOrder();

const NAME = 'accounts-2026.pdf';

test.describe('step 9: the manager triages the submissions', () => {
  test('filters by round and status, opens one and comes back to the same list', async ({
    pages,
  }) => {
    const page = await pages.staff('manager');
    await page.goto('/northfield/');
    await openSubmissions(page);
    // Six submitted and one withdrawn.
    await expect(submissionRows(page)).toHaveCount(7);
    await filterByRoundAndStatus(page);
    await expect(submissionRows(page)).toHaveCount(6);
    await openOneAndReturn(page);
  });

  test('reads a submission: the answers with the budget table and its total, the eligibility result and the history', async ({
    pages,
  }) => {
    const page = await pages.staff('manager');
    await page.goto(`/northfield/submissions/${need('application1Id')}`);
    await expect(h1(page, /Eastmere Community Garden|Application/)).toBeVisible();
    const answers = page.getByRole('tabpanel', { name: 'Application' });
    await expect(answers).toContainText('Hall hire');
    await expect(answers).toContainText('£2,500');
    await expect(answers).toContainText('Laptops');
    await expect(answers).toContainText('£3,500');
    await expect(answers).toContainText('£6,000');
    await expect(
      answers.getByRole('link', { name: new RegExp(`^Download ${NAME}, PDF, `) }),
    ).toBeVisible();

    await page.getByRole('tab', { name: 'Eligibility' }).click();
    const latest = page
      .getByRole('table', { name: 'Eligibility checks, latest first' })
      .locator('tbody > tr')
      .first();
    await expect(latest).toContainText('Eligible');
    await expect(latest).toContainText('Not stopped');
    await page.getByRole('tab', { name: 'History' }).click();
    const history = page.getByRole('list', { name: 'History, newest first' });
    await expect(history).toContainText('Submitted');
  });

  test('downloads the accounts as an attachment, and the download is in the audit log', async ({
    pages,
  }) => {
    const manager = await pages.staff('manager');
    const submissionId = need('application1Id');
    await manager.goto(`/northfield/submissions/${submissionId}`);
    const link = manager
      .getByRole('tabpanel', { name: 'Application' })
      .getByRole('link', { name: new RegExp(`^Download ${NAME}, PDF, `) });
    const href = (await link.getAttribute('href')) ?? '';
    const fileId = href.split('/').at(-1) ?? '';
    expect(href).toBe(`/api/console/submissions/${submissionId}/files/${fileId}`);
    updateState((state) => {
      state.ids['accountsFileId'] = fileId;
    });

    const [saved] = await Promise.all([manager.waitForEvent('download'), link.click()]);
    expect(saved.suggestedFilename()).toBe(NAME);
    expect((await readFile(await saved.path())).toString().slice(0, 5)).toBe('%PDF-');

    const sent = await manager.request.get(href);
    expect(sent.status()).toBe(200);
    expect(sent.headers()['content-disposition']).toMatch(/^attachment;/);
    expect(sent.headers()['x-content-type-options']).toBe('nosniff');
    expect(sent.headers()['content-type']).toBe('application/pdf');

    // The administrator reads the log: each of the two downloads is there, with no file name in it.
    const admin = await pages.staff('admin');
    const events = await auditEvents(admin.request, {
      action: 'platform.file.downloaded',
      entityId: fileId,
    });
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(events)).not.toContain(NAME);
    expect(events[0]?.actor.kind).toBe('staff');
  });

  test('moves five submissions to Review in bulk', async ({ pages }) => {
    const page = await pages.staff('manager');
    await page.goto('/northfield/submissions');
    await filterByRoundAndStatus(page);
    await moveFiveToReview(page);
    await expect(submissionRows(page).filter({ hasText: 'Review' })).toHaveCount(5);
    await expect(submissionRows(page).filter({ hasText: 'Intake' })).toHaveCount(1);

    // Each moved one has the move in its history.
    const moved = await auditEvents((await pages.staff('admin')).request, {
      action: 'grants.application.stage_changed',
    });
    expect(moved.length).toBeGreaterThanOrEqual(5);
    expect(needList('applicationIds')).toHaveLength(6);
  });

  test('@a11y the submissions pages have no axe violations', async ({ pages }) => {
    await axePages(await pages.staff('manager'), [
      '/northfield/submissions',
      `/northfield/submissions/${need('application1Id')}`,
    ]);
  });
});
