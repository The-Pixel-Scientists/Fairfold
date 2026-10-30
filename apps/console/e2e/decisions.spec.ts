// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The decision screens in a real browser, with the API's answers stubbed
// (decisions-api.ts): a funder with a round of submissions, decisions that stay
// private until released, and step-up before release. The same steps run
// against the real API in decisions-journey.spec.ts. Every spec also fails on
// a Content Security Policy violation, so the screens are checked under the
// production policy in console-production.

import { productName } from '@pixel-scientists/domain/platform';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';

import { ids, stubDecisions } from './decisions-api.ts';
import {
  decisionRows,
  decisionsTable,
  expectBudgetWords,
  expectReleased,
  h1,
  openDecisions,
  openFirstSubmission,
  recordAwardFromTheDetail,
  recordSeveral,
  startRelease,
} from './decisions-steps.ts';
import { confirmItsYou } from './team-steps.ts';

const SUFFIX = `– ${productName} console`;

test.describe('a programme manager recording and releasing decisions', () => {
  test('records one from the submission and the rest in bulk, then releases after confirming it is them', async ({
    page,
  }) => {
    const stub = await stubDecisions(page);
    await page.goto('/northfield/submissions');

    await openFirstSubmission(page);
    await recordAwardFromTheDetail(page, '12,500');
    await openDecisions(page);
    await expect(page).toHaveTitle(`Decisions ${SUFFIX}`);
    await expectBudgetWords(page, '£12,500 of £150,000, £137,500 left');
    await expect(decisionRows(page).first()).toContainText('Accepted');
    await expect(decisionRows(page).first()).toContainText('£12,500');

    await recordSeveral(page, 3, 'Declined');
    await recordSeveral(page, 2, 'Waitlisted');
    await expect(page.getByRole('group', { name: 'Decision summary' })).toContainText(
      'Decided6 of 6',
    );
    expect([...stub.decisions.values()].every((item) => item.releasedAt === null)).toBe(true);

    await startRelease(page);
    await confirmItsYou(page, 'correct horse battery', '123456');
    await expectReleased(page);
    expect([...stub.decisions.values()].every((item) => item.releasedAt !== null)).toBe(true);

    await page.getByRole('link', { name: 'Back to decisions' }).click();
    await expect(decisionRows(page).first()).toContainText('Released');
    await expect(decisionRows(page).first()).toContainText('Email: sent');
    await expect(page.getByRole('button', { name: /^Change decision/ })).toHaveCount(0);
  });

  test('shows going over the budget in words and still lets the awards be recorded', async ({
    page,
  }) => {
    await stubDecisions(page, { budget: 30_000 });
    await page.goto(`/northfield/rounds/${ids.round}/decisions`);
    await expect(decisionsTable(page)).toBeVisible();

    for (let index = 0; index < 2; index += 1) {
      const row = decisionRows(page).filter({ hasText: 'No decision yet' }).first();
      await row.getByRole('button', { name: /^Record decision/ }).click();
      const dialog = page.getByRole('dialog', { name: 'Record decision' });
      await dialog.getByRole('radio', { name: /^Accepted/ }).check();
      await dialog.getByLabel('Amount to award').fill('20,000');
      await dialog.getByRole('button', { name: 'Record decision' }).click();
      await expect(dialog).toBeHidden();
    }

    await expectBudgetWords(page, '£40,000 of £30,000, £10,000 over budget');
    await expect(page.getByText("The awards are over the round's budget")).toBeVisible();
    await expect(page.getByRole('link', { name: 'Release decisions' })).toBeVisible();
  });

  test('says what is wrong with an amount before sending it, and what the range is', async ({
    page,
  }) => {
    const stub = await stubDecisions(page);
    await page.goto(`/northfield/rounds/${ids.round}/decisions`);

    await decisionRows(page)
      .first()
      .getByRole('button', { name: /^Record decision/ })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Record decision' });
    await dialog.getByRole('radio', { name: /^Accepted/ }).check();
    await expect(dialog).toContainText('Between £5,000 and £25,000, in pounds.');
    await dialog.getByLabel('Amount to award').fill('30,000');
    await dialog.getByRole('button', { name: 'Record decision' }).click();

    await expect(dialog.getByRole('alert')).toContainText(
      'Enter an amount between £5,000 and £25,000.',
    );
    await expect(dialog.getByLabel('Amount to award')).toHaveAttribute('aria-invalid', 'true');
    expect(stub.sent.some(({ key }) => key.startsWith('PUT'))).toBe(false);
  });

  test('previews the email for a recorded decision without sending it', async ({ page }) => {
    const stub = await stubDecisions(page);
    await page.goto(`/northfield/rounds/${ids.round}/decisions`);
    await recordSeveral(page, 1, 'Waitlisted');

    const row = decisionRows(page).filter({ hasText: 'Waitlisted' });
    await row.getByRole('button', { name: /^Preview email/ }).click();
    const dialog = page.getByRole('dialog', { name: /^Email for / });
    await expect(dialog).toContainText('your application is on our waiting list');
    await expect(dialog).toContainText('Nothing is sent now.');
    await page.keyboard.press('Escape');
    await expect(row.getByRole('button', { name: /^Preview email/ })).toBeFocused();
    expect(stub.sent.some(({ key }) => key.includes('/release'))).toBe(false);
  });

  test('sends the emails that are still waiting after a release', async ({ page }) => {
    const stub = await stubDecisions(page, { holdBack: 2 });
    await page.goto(`/northfield/rounds/${ids.round}/decisions`);
    await recordSeveral(page, 4, 'Declined');

    await startRelease(page);
    await confirmItsYou(page, 'correct horse battery', '123456');
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: '4 decisions released. 2 emails sent. 2 waiting to send.' }),
    ).toBeFocused();

    await page.getByRole('button', { name: 'Send unsent emails' }).click();
    const sent = page.getByRole('status').filter({ hasText: '2 emails sent. 0 waiting to send.' });
    await expect(sent).toBeFocused();
    await expect(page.getByRole('button', { name: 'Send unsent emails' })).toHaveCount(0);
    expect([...stub.decisions.values()].every((item) => item.email === 'sent')).toBe(true);
    expect(stub.sent.filter(({ key }) => key === 'POST /auth/step-up')).toHaveLength(1);
  });

  test('releases nothing when the password is not right', async ({ page }) => {
    const stub = await stubDecisions(page);
    await page.goto(`/northfield/rounds/${ids.round}/decisions`);
    await recordSeveral(page, 2, 'Declined');
    await startRelease(page);

    const dialog = page.getByRole('dialog', { name: 'Confirm it is you' });
    await dialog.getByLabel('Password').fill('wrong password');
    await dialog.getByLabel('Code from your authenticator app').fill('123456');
    await dialog.getByRole('button', { name: 'Confirm it is you' }).click();

    await expect(dialog.getByRole('alert')).toContainText(
      'Your password or code is not right. Check them and try again.',
    );
    expect(stub.sent.some(({ key }) => key.endsWith('/decisions/release'))).toBe(false);
  });

  test('is operated from the keyboard: arrows move between rows, Enter opens the decision and ? lists the keys', async ({
    page,
  }) => {
    await stubDecisions(page);
    await page.goto(`/northfield/rounds/${ids.round}/decisions`);
    await expect(decisionsTable(page)).toBeVisible();
    await decisionRows(page).first().focus();

    await page.keyboard.press('ArrowDown');
    await expect(decisionRows(page).nth(1)).toBeFocused();
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toContainText(
      'Record or change the decision',
    );
    await page.keyboard.press('Escape');
    await page.keyboard.press('Space');
    await expect(page.getByRole('group', { name: 'Bulk actions' })).toContainText(
      '1 submission selected',
    );
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Record decision' })).toBeVisible();
  });

  test('tells someone who cannot release that the page is not theirs, and hides the way to it', async ({
    page,
  }) => {
    await stubDecisions(page, {
      permissions: ['grants.applications.read', 'grants.decisions.record'],
    });
    await page.goto(`/northfield/rounds/${ids.round}/decisions`);
    await expect(decisionsTable(page)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Release decisions' })).toHaveCount(0);

    await page.goto(`/northfield/rounds/${ids.round}/decisions/release`);
    await expect(h1(page, 'Release decisions')).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: 'You cannot release decisions' }),
    ).toBeVisible();
  });
});
