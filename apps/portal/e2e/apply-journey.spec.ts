// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Demo step 8 against the real API, across two sign-ins: an applicant opens the
// open round, is stopped once and why, fills the form in two sittings, sees
// what is missing, and submits. It needs the stack, seeded with the published
// Community Spaces Fund form: `pnpm stack`, then `pnpm test:stack -- apply`.
// It answers the form's questions by what each control is (apply-steps.ts), so
// it follows the seed's form. The documents are in apply-files-journey.spec.ts.

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import {
  PASSWORD,
  answerQuestions,
  createApplicant,
  h1,
  main,
  startApplication,
} from './apply-steps.ts';
import { signIn } from './mailpit.ts';

test.describe('an applicant applying, against the real API', () => {
  test.skip(
    process.env['TPS_E2E_STACK'] !== '1',
    'Runs against the stack: pnpm stack, then pnpm test:stack -- apply.',
  );
  test.setTimeout(300_000);

  test('@api is stopped once, fills the form over two sittings, sees what is missing and submits', async ({
    page,
  }) => {
    const address = await createApplicant(page);
    await startApplication(page);

    // Eligibility first: one answer stops the applicant, and says why.
    await page.getByRole('link', { name: 'Continue with Check you can apply' }).click();
    await expect(h1(page, 'Check you can apply')).toBeVisible();
    const radios = await main(page).getByRole('radio').all();
    let stopped = false;
    for (const radio of radios) {
      await radio.check();
      if ((await page.getByRole('alert').count()) > 0) {
        stopped = true;
        await expect(page.getByRole('alert')).toContainText('You cannot apply with this answer');
        break;
      }
    }
    expect(stopped, 'one answer to the eligibility question stops the applicant').toBe(true);
    for (const radio of radios) {
      await radio.check();
      if ((await page.getByRole('alert').count()) === 0) break;
    }
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await expect(h1(page, 'Your application')).toBeVisible();
    await expect(page.getByText('Cannot start yet')).toHaveCount(0);

    // First sitting: the first section, then sign out.
    await page.getByRole('link', { name: /^Continue with / }).click();
    await expect(page.getByText(/^Section 1 of /)).toBeVisible();
    await answerQuestions(page);
    await expect(page.getByText(/^Saved at \d/)).toBeVisible();
    await page.getByRole('button', { name: 'Save and come back later' }).click();
    await expect(h1(page, 'Your application')).toBeVisible();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(h1(page, 'You have signed out')).toBeVisible();

    // Second sitting, signed in afresh: the answers are there, and the rest is filled in except the last section.
    await signIn(page, address, PASSWORD);
    await page.goto('/northfield/applications');
    await page.getByRole('link', { name: /^Continue application for / }).click();
    await expect(page.getByText('In progress').first()).toBeVisible();
    await page.getByRole('link', { name: /^Continue with / }).click();
    // Every section is answered but the budget, which the check page will list as missing.
    for (;;) {
      const progress = await page.getByText(/^Section \d+ of \d+/).textContent();
      if ((await h1(page, 'Budget').count()) > 0) break;
      const [, current, total] = /Section (\d+) of (\d+)/.exec(progress ?? '') ?? ['', '1', '1'];
      await answerQuestions(page);
      await page.getByRole('button', { name: 'Save and continue' }).click();
      await expect(
        page.getByText(`Section ${String(Number(current) + 1)} of ${total}`),
      ).toBeVisible();
    }
    await page.getByRole('button', { name: 'Save and come back later' }).click();

    // The check page lists what is missing, with a link to it, and offers no submit.
    await page.getByRole('link', { name: 'Check your answers' }).first().click();
    const missing = page.getByRole('region', { name: 'Before you can send your application' });
    await expect(missing).toBeVisible();
    await expect(page.getByRole('button', { name: 'Submit application' })).toHaveCount(0);
    await missing.getByRole('link').first().click();
    await answerQuestions(page);
    await page.getByRole('button', { name: 'Save and check your answers' }).click();
    await expect(h1(page, 'Check your answers')).toBeVisible();
    await expect(missing).toHaveCount(0);
    await page.getByRole('button', { name: 'Submit application' }).click();

    await expect(h1(page, 'Application submitted')).toBeVisible();
    await page.goto('/northfield/applications');
    await expect(page.getByText('Submitted', { exact: true })).toBeVisible();
  });
});
