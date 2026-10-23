// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Demo step 12: the manager records two awards with amounts, a waitlist and
// declines, singly and in bulk. Nothing goes to the applicants: they still see
// "Under review" (or "Submitted", for the one still in Intake), no email is
// sent, and every decision is audited.

import {
  decisionsTable,
  expectBudgetWords,
  openDecisions,
  openFirstSubmission,
  recordAwardFromTheDetail,
  recordSeveral,
} from '../../apps/console/e2e/decisions-steps.ts';
import { signInApplicant } from '../support/api.ts';
import { groups } from '../support/applications.ts';
import { auditEvents } from '../support/audit.ts';
import { axePages } from '../support/axe.ts';
import { countSubject } from '../support/mail.ts';
import { need, needList, readState, updateState } from '../support/state.ts';
import { expect, inOrder, test } from '../support/test.ts';

inOrder();

/** What an outcome would give away before it is released. */
const OUTCOME_WORDS = /awarded|waiting list|not funded|successful|congratulations|£\d/i;

interface Row {
  submissionId: string;
  decision: {
    outcome: string;
    amount: { amountMinor: number } | null;
    releasedAt: string | null;
  } | null;
}

test.describe('step 12: the manager records decisions, privately', () => {
  test('records two awards from the submission pages, then a waitlist and declines in bulk', async ({
    pages,
  }) => {
    const before = await countSubject('Community Spaces Fund:');
    const recorded = await auditEvents((await pages.staff('admin')).request, {
      action: 'grants.decision.recorded',
    });

    const page = await pages.staff('manager');
    await page.goto('/northfield/');
    await openFirstSubmission(page);
    await recordAwardFromTheDetail(page, '12,500');
    await page.goto(`/northfield/submissions/${needList('applicationIds')[1] ?? ''}`);
    await recordAwardFromTheDetail(page, '7,500');
    await openDecisions(page);
    await expectBudgetWords(page, /^£20,000 of £150,000, £130,000 left$/);
    await recordSeveral(page, 2, 'Waitlisted');
    await recordSeveral(page, 2, 'Declined');
    await expect(decisionsTable(page).getByText('Released', { exact: true })).toHaveCount(0);
    await expect(
      decisionsTable(page).locator('tbody > tr').filter({ hasText: 'No decision yet' }),
    ).toHaveCount(0);

    expect(await countSubject('Community Spaces Fund:')).toBe(before);
    const after = await auditEvents((await pages.staff('admin')).request, {
      action: 'grants.decision.recorded',
    });
    expect(after.length - recorded.length).toBe(6);

    const list = (await (
      await page.request.get(`/api/console/rounds/${need('roundId')}/decisions`)
    ).json()) as { submissions: Row[] };
    expect(list.submissions).toHaveLength(6);
    updateState((state) => {
      for (const { submissionId, decision } of list.submissions) {
        state.ids[`decision:${submissionId}`] =
          `${decision?.outcome ?? ''}:${String(decision?.amount?.amountMinor ?? 0)}`;
      }
    });
    const outcomes = Object.values(readState().ids).filter((value) =>
      /^(accepted|waitlisted|declined):/.test(value),
    );
    expect(outcomes.filter((value) => value.startsWith('accepted:'))).toHaveLength(2);
    expect(outcomes.filter((value) => value.startsWith('waitlisted:'))).toHaveLength(2);
    expect(outcomes.filter((value) => value.startsWith('declined:'))).toHaveLength(2);
    expect(list.submissions.every(({ decision }) => decision?.releasedAt === null)).toBe(true);
  });

  test('every applicant still sees "Under review" or "Submitted", and nothing of the decision', async ({
    pages,
  }) => {
    const names = ['applicant1', ...groups.slice(0, 5).map(({ name }) => name)];
    for (const name of names) {
      const api = await signInApplicant('northfield', name);
      const { applications } = await api.ok<{
        applications: { id: string; status: string; outcome: unknown }[];
      }>('GET', '/portal/applications');
      expect(applications, name).toHaveLength(1);
      expect(applications[0]?.status, name).toMatch(/^(submitted|under_review)$/);
      expect(applications[0]?.outcome, name).toBeNull();
      const detail = await api.send('GET', `/portal/applications/${applications[0]?.id ?? ''}`);
      expect(detail.text, name).not.toMatch(
        /"(accepted|waitlisted|declined)"|"decision"|"releasedAt"/,
      );
      await api.dispose();
    }

    const page = await pages.applicant('applicant1');
    await page.goto('/northfield/applications');
    await expect(page.getByText(/^(Under review|Submitted)$/)).toBeVisible();
    await expect(page.getByRole('link', { name: /^Read your outcome/ })).toHaveCount(0);
    await expect(page.getByRole('main')).not.toContainText(OUTCOME_WORDS);
    await page.goto(`/northfield/applications/${need('application1Id')}/outcome`);
    await expect(page.getByRole('main')).not.toContainText(OUTCOME_WORDS);
  });

  test('@a11y the decisions page has no axe violations', async ({ pages }) => {
    await axePages(await pages.staff('manager'), [
      `/northfield/rounds/${need('roundId')}/decisions`,
    ]);
  });
});
