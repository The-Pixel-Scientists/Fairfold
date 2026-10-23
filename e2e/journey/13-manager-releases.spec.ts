// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Demo step 13: releasing needs the manager to confirm it is them again (a
// password and a fresh code), which a wrong password does not do. After
// release the emails arrive in Mailpit, each applicant's portal shows their
// outcome, and the release is audited.

import { confirmItsYou } from '../../apps/console/e2e/team-steps.ts';
import {
  decisionRows,
  expectReleased,
  startRelease,
} from '../../apps/console/e2e/decisions-steps.ts';
import { signInApplicant } from '../support/api.ts';
import { groups } from '../support/applications.ts';
import { auditEvents } from '../support/audit.ts';
import { axePages } from '../support/axe.ts';
import { consoleOrigin } from '../support/env.ts';
import { countSubject, waitForMessages } from '../support/mail.ts';
import { need, person, readState } from '../support/state.ts';
import { nextCode } from '../support/totp.ts';
import { expect, h1, inOrder, test } from '../support/test.ts';

inOrder();

const SUBJECT = 'Community Spaces Fund:';
const STATUS: Record<string, string> = {
  accepted: 'awarded',
  waitlisted: 'waitlisted',
  declined: 'not_funded',
};
const names = ['applicant1', ...groups.slice(0, 5).map(({ name }) => name)];

/** The decision recorded for an applicant's application, as step 12 left it. */
function decisionOf(name: string): { outcome: string; amountMinor: number } {
  const state = readState();
  const applicationId =
    state.ids[name === 'applicant1' ? 'application1Id' : `${name}ApplicationId`];
  const [outcome = '', amount = '0'] = (state.ids[`decision:${applicationId ?? ''}`] ?? '').split(
    ':',
  );
  return { outcome, amountMinor: Number(amount) };
}

test.describe('step 13: the manager releases the decisions', () => {
  test('confirming it is them refuses a wrong password, and nothing is released', async ({
    pages,
  }) => {
    const page = await pages.staff('manager');
    const before = await countSubject(SUBJECT);
    const refused = await page.request.post('/api/auth/step-up', {
      data: { password: 'not the manager passphrase', code: await nextCode('manager') },
      headers: { origin: consoleOrigin },
    });
    expect(refused.status()).toBeGreaterThanOrEqual(400);
    expect(refused.status()).toBeLessThan(500);
    expect(await countSubject(SUBJECT)).toBe(before);
    const list = (await (
      await page.request.get(`/api/console/rounds/${need('roundId')}/decisions`)
    ).json()) as { submissions: { decision: { releasedAt: string | null } }[] };
    expect(list.submissions.every(({ decision }) => decision.releasedAt === null)).toBe(true);
  });

  test('confirms it is them, releases, and the emails go', async ({ pages }) => {
    const before = await countSubject(SUBJECT);
    const admin = await pages.staff('admin');
    const released = (await auditEvents(admin.request, { action: 'grants.decision.released' }))
      .length;

    const page = await pages.staff('manager');
    await page.goto(`/northfield/rounds/${need('roundId')}/decisions`);
    await startRelease(page);
    await confirmItsYou(page, person('manager').password, await nextCode('manager'));
    await expectReleased(page);

    await expect
      .poll(() => countSubject(SUBJECT), { message: 'The emails have not arrived.' })
      .toBe(before + 6);
    await page.getByRole('link', { name: 'Back to decisions' }).click();
    await expect(decisionRows(page).filter({ hasText: 'Email: sent' })).toHaveCount(6);
    expect(
      (await auditEvents(admin.request, { action: 'grants.decision.released' })).length - released,
    ).toBe(6);
    expect(
      (await auditEvents(admin.request, { action: 'grants.decision_email.sent' })).length,
    ).toBe(6);
  });

  test('each applicant is emailed their own outcome, and their portal shows it', async ({
    pages,
  }) => {
    for (const name of names) {
      const { outcome, amountMinor } = decisionOf(name);
      const api = await signInApplicant('northfield', name);
      const { applications } = await api.ok<{
        applications: {
          status: string;
          outcome: { result: string; amount?: { amountMinor: number } };
        }[];
      }>('GET', '/portal/applications');
      expect(applications[0]?.status, name).toBe(STATUS[outcome]);
      expect(applications[0]?.outcome.result, name).toBe(outcome);
      if (outcome === 'accepted')
        expect(applications[0]?.outcome.amount?.amountMinor).toBe(amountMinor);
      await api.dispose();

      const [email] = await waitForMessages(person(name).email);
      expect(email?.subject, name).toContain(SUBJECT);
      expect(email?.text, name).not.toMatch(/score|reviewer|shortlist|rank/i);
      if (outcome === 'accepted') {
        expect(email?.text, name).toContain(`£${(amountMinor / 100).toLocaleString('en-GB')}`);
      }
    }

    const page = await pages.applicant('applicant1');
    await page.goto('/northfield/applications');
    await page.getByRole('link', { name: /^Read your outcome/ }).click();
    const { outcome } = decisionOf('applicant1');
    await expect(h1(page, /./)).toBeVisible();
    await expect(page.getByRole('main')).not.toContainText(/score|reviewer|stage|rank/i);
    if (outcome === 'accepted')
      await expect(page.getByRole('main')).toContainText('You have been awarded');
  });

  test('@a11y the release and outcome pages have no axe violations', async ({ pages }) => {
    await axePages(await pages.staff('manager'), [
      `/northfield/rounds/${need('roundId')}/decisions`,
    ]);
    await axePages(await pages.applicant('applicant1'), [
      '/northfield/applications',
      `/northfield/applications/${need('application1Id')}/outcome`,
    ]);
  });
});
