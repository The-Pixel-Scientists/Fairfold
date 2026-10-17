// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Demo step 8 against the real API, across two sign-ins: an applicant opens the
// open round, is stopped once and why, fills the form in two sittings, sees
// what is missing, and submits. It needs the stack, seeded with the published
// Community Spaces Fund form: `pnpm stack`, then `pnpm test:stack -- apply`.
// It answers the form's questions by what each control is, not by its words, so
// it follows the seed's form. The file question is out of scope here (S06-10).

// The callbacks passed to evaluate run in the browser, so they use DOM types.
/// <reference lib="dom" />

import type { Locator, Page } from '@playwright/test';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import { createAccount, signIn } from './mailpit.ts';

const PASSWORD = 'a long passphrase for the demo';

const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });
const main = (page: Page) => page.getByRole('main');

/** The next question in the form that has not been answered: what kind of control it is decides the answer. */
async function answerQuestions(page: Page): Promise<void> {
  for (const radio of await main(page).getByRole('group').all()) {
    const first = radio.getByRole('radio').first();
    if ((await first.count()) > 0 && !(await radio.getByRole('radio', { checked: true }).count())) {
      await first.check();
    }
  }
  for (const group of await main(page).getByRole('group').all()) {
    const box = group.getByRole('checkbox').first();
    if (
      (await box.count()) > 0 &&
      !(await group.getByRole('checkbox', { checked: true }).count())
    ) {
      await box.check();
    }
  }
  for (const select of await main(page).getByRole('combobox').all()) {
    await select.selectOption({ index: 1 });
  }
  await fillTextboxes(await main(page).getByRole('textbox').all());
}

async function fillTextboxes(boxes: Locator[]): Promise<void> {
  for (const box of boxes) {
    if ((await box.inputValue()) !== '') continue;
    const type = (await box.getAttribute('type')) ?? 'text';
    const label = await box.evaluate(
      (input: HTMLInputElement) => input.labels?.[0]?.textContent ?? '',
    );
    const answers: Record<string, string> = {
      email: 'hello@eastmere.example',
      url: 'https://eastmere.example.org',
      tel: '01632 960 001',
      number: '40',
    };
    const value = /^day$/i.test(label)
      ? '12'
      : /^month$/i.test(label)
        ? '5'
        : /^year$/i.test(label)
          ? '2027'
          : /postcode/i.test(label)
            ? 'EA1 2ST'
            : (answers[type] ?? 'A synthetic answer for the demo.');
    await box.fill(value);
  }
}

test.describe('an applicant applying, against the real API', () => {
  test.skip(
    process.env['TPS_E2E_STACK'] !== '1',
    'Runs against the stack: pnpm stack, then pnpm test:stack -- apply.',
  );
  test.setTimeout(300_000);

  test('@api is stopped once, fills the form over two sittings, sees what is missing and submits', async ({
    page,
  }) => {
    const address = `applicant-${String(Date.now())}@example.org`;
    await createAccount(page, address, PASSWORD);
    await signIn(page, address, PASSWORD);
    await expect(h1(page, 'Apply for a grant')).toBeVisible();

    // An organisation to apply for, as step 7 adds it.
    await page.getByRole('link', { name: 'Your organisations' }).click();
    await page.getByRole('link', { name: 'Add your organisation' }).click();
    await page
      .getByRole('textbox', { name: 'Organisation name' })
      .fill('Eastmere Community Garden');
    await page
      .getByRole('combobox', { name: 'Type of organisation' })
      .selectOption({ label: 'Registered charity' });
    await page.getByRole('button', { name: 'Add a charity or company number' }).click();
    await page.getByRole('textbox', { name: 'Number', exact: true }).fill('1187654');
    await page.getByRole('textbox', { name: 'Address line 1' }).fill('12 Mill Lane');
    await page.getByRole('textbox', { name: 'Town or city' }).fill('Eastmere');
    await page.getByRole('textbox', { name: 'Postcode' }).fill('ea1 2st');
    await page.getByRole('button', { name: 'Add organisation' }).click();
    await expect(page.getByText('Your organisation is added.')).toBeVisible();

    // The open programme, and starting.
    await page.goto('/northfield/programmes');
    await expect(h1(page, 'Programmes you can apply to')).toBeVisible();
    await page
      .getByRole('link', { name: /^Read more and apply for Community Spaces Fund/ })
      .click();
    await expect(h1(page, 'Community Spaces Fund')).toBeVisible();
    await expect(page.getByText(/UK time/).first()).toBeVisible();
    await page.getByRole('link', { name: 'Start application' }).click();
    await page.getByRole('button', { name: 'Start application' }).click();
    await expect(h1(page, 'Your application')).toBeVisible();

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
    for (;;) {
      const [, current, total] = /Section (\d+) of (\d+)/.exec(
        (await page.getByText(/^Section \d+ of \d+/).textContent()) ?? '',
      ) ?? ['', '1', '1'];
      if (current === total) break;
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
