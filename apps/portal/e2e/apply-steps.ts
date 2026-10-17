// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the apply specs that run against the real API share: an applicant with
// an organisation, starting an application for the open programme, and
// answering a section's questions by what each control is, not by its words,
// so the steps follow the seeded form. They need the stack, seeded with the
// published Community Spaces Fund form: `pnpm stack`, then
// `pnpm test:stack -- apply`.

// The callbacks passed to evaluate run in the browser, so they use DOM types.
/// <reference lib="dom" />

import type { Locator, Page } from '@playwright/test';

import { expect } from '../../../scripts/e2e/fixtures.ts';
import { createAccount, signIn } from './mailpit.ts';

export const PASSWORD = 'a long passphrase for the demo';

export const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });
export const main = (page: Page) => page.getByRole('main');

/** A new applicant, signed in, who has added an organisation to apply for. Returns their email address. */
export async function createApplicant(page: Page): Promise<string> {
  const address = `applicant-${String(Date.now())}@example.org`;
  await createAccount(page, address, PASSWORD);
  await signIn(page, address, PASSWORD);
  await expect(h1(page, 'Apply for a grant')).toBeVisible();

  await page.getByRole('link', { name: 'Your organisations' }).click();
  await page.getByRole('link', { name: 'Add your organisation' }).click();
  await page.getByRole('textbox', { name: 'Organisation name' }).fill('Eastmere Community Garden');
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
  return address;
}

/** From the open programme to the new application's page. */
export async function startApplication(page: Page): Promise<void> {
  await page.goto('/northfield/programmes');
  await expect(h1(page, 'Programmes you can apply to')).toBeVisible();
  await page.getByRole('link', { name: /^Read more and apply for Community Spaces Fund/ }).click();
  await expect(h1(page, 'Community Spaces Fund')).toBeVisible();
  await expect(page.getByText(/UK time/).first()).toBeVisible();
  await page.getByRole('link', { name: 'Start application' }).click();
  await page.getByRole('button', { name: 'Start application' }).click();
  await expect(h1(page, 'Your application')).toBeVisible();
}

/** Opens the eligibility questions and chooses the answers that let the applicant carry on. */
export async function passEligibility(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Continue with Check you can apply' }).click();
  await expect(h1(page, 'Check you can apply')).toBeVisible();
  for (const radio of await main(page).getByRole('radio').all()) {
    await radio.check();
    if ((await page.getByRole('alert').count()) === 0) break;
  }
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(h1(page, 'Your application')).toBeVisible();
}

/** The answers by control: a number or an amount in range, an address, a date, a plain answer. */
async function fillTextboxes(boxes: Locator[]): Promise<void> {
  for (const box of boxes) {
    if ((await box.inputValue()) !== '') continue;
    const type = (await box.getAttribute('type')) ?? 'text';
    const mode = (await box.getAttribute('inputmode')) ?? '';
    const label = await box.evaluate(
      (input: HTMLInputElement) => input.labels?.[0]?.textContent ?? '',
    );
    const answers: Record<string, string> = {
      email: 'hello@eastmere.example',
      url: 'https://eastmere.example.org',
      tel: '01632 960 001',
    };
    const value = /^day$/i.test(label)
      ? '12'
      : /^month$/i.test(label)
        ? '5'
        : /^year$/i.test(label)
          ? '2027'
          : /postcode/i.test(label)
            ? 'EA1 2ST'
            : /^(decimal|numeric)$/.test(mode)
              ? '6000'
              : (answers[type] ?? 'A synthetic answer for the demo.');
    await box.fill(value);
  }
}

/** Answers every question on the screen that has not been answered, including the first row of a table. */
export async function answerQuestions(page: Page): Promise<void> {
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
  for (const add of await main(page)
    .getByRole('button', { name: /^Add the first / })
    .all()) {
    await add.click();
  }
  await fillTextboxes(await main(page).getByRole('textbox').all());
}
