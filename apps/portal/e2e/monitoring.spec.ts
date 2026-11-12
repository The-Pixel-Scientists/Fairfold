// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The optional equality monitoring step after an application is sent, in a real
// browser, with the API's answers stubbed (apply-api.ts, monitoring-api.ts):
// answering with "Prefer not to say", being refused without consent, skipping,
// and withdrawing.

import type { Page } from '@playwright/test';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import { APPLICATION_ID, draft, sent, stubApply } from './apply-api.ts';
import { stubMonitoring } from './monitoring-api.ts';

const home = `/northfield/applications/${APPLICATION_ID}`;
const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });
const sentApplication = sent({ id: APPLICATION_ID });

/** Opens the questions and answers the first with "Prefer not to say". */
async function startAnswering(page: Page) {
  await page.goto(`${home}/monitoring`);
  await page.getByRole('button', { name: 'Answer monitoring questions' }).click();
  await expect(h1(page, 'Equality monitoring questions')).toBeFocused();
  await page.getByRole('main').getByRole('radio', { name: 'Prefer not to say' }).first().check();
}

test.describe('equality monitoring', () => {
  test('is offered on the confirmation page, and answered with Prefer not to say and consent', async ({
    page,
  }) => {
    const monitoring = stubMonitoring(APPLICATION_ID);
    await stubApply(page, { applications: [sentApplication], more: monitoring.handlers });
    await page.goto(`${home}/submitted`);

    await page.getByRole('link', { name: 'Answer monitoring questions' }).click();
    await expect(h1(page, 'Equality monitoring')).toBeFocused();
    await expect(page.getByText(/only use your answers to count totals/)).toBeVisible();
    await page.getByRole('button', { name: 'Answer monitoring questions' }).click();
    await page.getByRole('main').getByRole('radio', { name: 'Prefer not to say' }).first().check();
    await page.getByRole('checkbox', { name: /I agree to my answers/ }).check();
    await page.getByRole('button', { name: 'Send my answers' }).click();

    await expect(h1(page, 'Your monitoring answers')).toBeFocused();
    await expect(page.getByText('Thank you. We have your answers.')).toBeVisible();
    expect(monitoring.saved).toEqual([
      expect.objectContaining({
        consent: true,
        answers: { f_agegroup: 'prefer_not_to_say' },
        privacyNoticeVersion: '1.0',
      }),
    ]);
  });

  test('refuses to send without consent, and says how to fix it', async ({ page }) => {
    const monitoring = stubMonitoring(APPLICATION_ID);
    await stubApply(page, { applications: [sentApplication], more: monitoring.handlers });
    await startAnswering(page);

    await page.getByRole('button', { name: 'Send my answers' }).click();

    await expect(page.getByRole('alert', { name: 'There is a problem' })).toContainText(
      'Tick the box to agree to your answers being used for equality monitoring.',
    );
    expect(monitoring.saved).toEqual([]);
  });

  test('skips from either screen without sending anything', async ({ page }) => {
    const monitoring = stubMonitoring(APPLICATION_ID);
    const stub = await stubApply(page, {
      applications: [sentApplication],
      more: monitoring.handlers,
    });

    await page.goto(`${home}/monitoring`);
    await page.getByRole('link', { name: 'Skip these questions' }).click();
    await expect(page).toHaveURL(new RegExp(`${home}$`));

    await startAnswering(page);
    await page.getByRole('link', { name: 'Skip these questions' }).click();
    await page.getByRole('button', { name: 'Leave and lose changes' }).click();
    await expect(page).toHaveURL(new RegExp(`${home}$`));

    const writes = stub.sent.filter(
      ({ key }) => key.includes('/monitoring') && !key.startsWith('GET'),
    );
    expect(writes).toEqual([]);
  });

  test('keeps nothing on the device or in the address', async ({ page }) => {
    await stubApply(page, {
      applications: [sentApplication],
      more: stubMonitoring(APPLICATION_ID).handlers,
    });
    await startAnswering(page);

    const stored = await page.evaluate(() => [
      window.localStorage.length,
      window.sessionStorage.length,
      window.location.search,
    ]);
    expect(stored).toEqual([0, 0, '']);
    await expect(page).not.toHaveURL(/prefer/);
  });

  test('shows the applicant their answers on the application page, and withdraws them', async ({
    page,
  }) => {
    const monitoring = stubMonitoring(APPLICATION_ID);
    await stubApply(page, { applications: [sentApplication], more: monitoring.handlers });
    await startAnswering(page);
    await page.getByRole('checkbox', { name: /I agree to my answers/ }).check();
    await page.getByRole('button', { name: 'Send my answers' }).click();
    await expect(h1(page, 'Your monitoring answers')).toBeVisible();

    await page.goto(home);
    await page.getByRole('link', { name: 'See my answers' }).click();
    await page.getByRole('button', { name: 'Withdraw my answers' }).click();

    await expect(h1(page, 'Your answers are deleted')).toBeFocused();
    await expect(
      page.getByText('We have deleted your monitoring answers. Your application has not changed.'),
    ).toBeVisible();
    expect(monitoring.withdrawn()).toBe(1);
  });

  test('shows nothing about monitoring before the application is sent', async ({ page }) => {
    const stub = await stubApply(page, {
      applications: [draft()],
      more: stubMonitoring(APPLICATION_ID).handlers,
    });
    await page.goto(home);

    await expect(h1(page, 'Your application')).toBeVisible();
    await expect(page.getByRole('main')).not.toContainText(/monitoring/i);
    expect(stub.sent.filter(({ key }) => key.includes('/monitoring'))).toEqual([]);
  });
});
