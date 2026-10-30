// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Demo step 8: the applicant answers eligibility (one ineligible answer shows
// the stop and why), fills the form over two sittings with autosave, fills in
// the budget table, uploads their accounts as a PDF (the antivirus test string
// is refused, nothing is stored and nothing else they typed is lost), sees the
// missing items on the review page and submits. Status: "Submitted".

import type { Page } from '@playwright/test';

import { answerQuestions, h1, main, startApplication } from '../../apps/portal/e2e/apply-steps.ts';
import { accountsPdf, virusPdf } from '../fixtures/files.ts';
import { signInApplicant, type Api } from '../support/api.ts';
import { axePages } from '../support/axe.ts';
import { need, updateState } from '../support/state.ts';
import { expect, inOrder, test } from '../support/test.ts';

inOrder();

const CLEAN = 'accounts-2026.pdf';
const INFECTED = 'invoice-from-ada.pdf';
/** The scan takes a few seconds, and the first after the stack starts loads the signatures. */
const scanned = expect.configure({ timeout: 90_000 });

const chooser = (page: Page) => page.locator('input[type="file"]');
const download = (page: Page) => page.getByRole('link', { name: new RegExp(`^Download ${CLEAN}`) });

/** The portal's address for the application, which the first test learned. */
const applicationPath = () => `/northfield/applications/${need('application1Id')}`;

async function applicationsOf(api: Api): Promise<{ id: string; status: string }[]> {
  return (
    await api.ok<{ applications: { id: string; status: string }[] }>('GET', '/portal/applications')
  ).applications;
}

test.describe('step 8: the applicant applies', () => {
  test('is stopped once by an ineligible answer, with the reason, and then passes', async ({
    pages,
  }) => {
    const page = await pages.applicant('applicant1');
    await startApplication(page);
    updateState((state) => {
      state.ids['application1Id'] = new URL(page.url()).pathname.split('/').at(-1) ?? '';
    });

    await page.getByRole('link', { name: 'Continue with Check you can apply' }).click();
    await expect(h1(page, 'Check you can apply')).toBeVisible();
    const yes = main(page).getByRole('radio', { name: 'Yes' });
    const no = main(page).getByRole('radio', { name: 'No', exact: true });
    await no.check();
    const stop = page.getByRole('alert');
    await expect(stop).toContainText('You cannot apply with this answer');
    await expect(stop).toContainText('We only fund registered charities.');
    await yes.check();
    await expect(stop).toHaveCount(0);
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await expect(h1(page, 'Your application')).toBeVisible();
    await expect(page.getByText('Cannot start yet')).toHaveCount(0);
  });

  test('fills the first section in one sitting, with autosave, and signs out', async ({
    pages,
  }) => {
    const page = await pages.applicant('applicant1');
    await page.goto(applicationPath());
    await page.getByRole('link', { name: /^Continue with / }).click();
    await expect(page.getByText(/^Section 1 of 3/)).toBeVisible();
    await answerQuestions(page);
    await main(page)
      .getByRole('textbox', { name: /^Organisation name/ })
      .fill('Eastmere Community Garden');
    await expect(page.getByText(/^Saved at \d/)).toBeVisible();
    await page.getByRole('button', { name: 'Save and come back later' }).click();
    await expect(h1(page, 'Your application')).toBeVisible();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(h1(page, 'You have signed out')).toBeVisible();
  });

  test('signs in again, finds the answers, and keeps a project answer that is over the word limit out of the way', async ({
    pages,
  }) => {
    const page = await pages.applicant('applicant1');
    await page.goto('/northfield/applications');
    await expect(page.getByText('In progress').first()).toBeVisible();
    await page.getByRole('link', { name: /^Continue application for / }).click();
    await page.getByRole('link', { name: 'About your organisation' }).click();
    await expect(main(page).getByRole('textbox', { name: /^Organisation name/ })).toHaveValue(
      'Eastmere Community Garden',
    );
    await page.goto(applicationPath());

    // The project section has a word limit of 300.
    await page.getByRole('link', { name: 'Your project', exact: true }).click();
    await expect(page.getByText(/^Section 2 of 3/)).toBeVisible();
    const project = main(page).getByRole('textbox', { name: /What will you do with the money/ });
    await project.fill(Array.from({ length: 301 }, (_, index) => `word${String(index)}`).join(' '));
    await expect(main(page)).toContainText('You have 1 word too many');
    await project.fill('We will turn the old shed into a warm room for the garden club.');
    await expect(main(page)).not.toContainText('too many');
    await expect(page.getByText(/^Saved at \d/)).toBeVisible();
  });

  test('fills in the budget table, which adds up', async ({ pages }) => {
    const page = await pages.applicant('applicant1');
    await page.goto(applicationPath());
    await page.getByRole('link', { name: 'Your budget', exact: true }).click();
    await expect(page.getByText(/^Section 3 of 3/)).toBeVisible();

    await main(page)
      .getByRole('textbox', { name: /How much are you asking for/ })
      .fill('6000');
    const costs = main(page).getByRole('group', { name: /^What will it cost/ });
    const first = costs.getByRole('group', { name: 'Cost 1' });
    await first.getByRole('textbox', { name: 'Item' }).fill('Hall hire');
    await first.getByRole('textbox', { name: 'Cost', exact: true }).fill('2500');
    await first.getByRole('combobox', { name: /^Kind/ }).selectOption('Staff');
    await costs.getByRole('button', { name: 'Add another cost' }).click();
    const second = costs.getByRole('group', { name: 'Cost 2' });
    await second.getByRole('textbox', { name: 'Item' }).fill('Laptops');
    await second.getByRole('textbox', { name: 'Cost', exact: true }).fill('3500');
    await second.getByRole('combobox', { name: /^Kind/ }).selectOption('Equipment');
    await expect(costs).toContainText('£6,000');
    await expect(page.getByText(/^Saved at \d/)).toBeVisible();
  });

  test('sees what is missing on the review page, with a way to it', async ({ pages }) => {
    const page = await pages.applicant('applicant1');
    await page.goto(applicationPath());
    await page.getByRole('link', { name: 'Check your answers' }).first().click();
    const missing = page.getByRole('region', { name: 'Before you can send your application' });
    await expect(missing).toBeVisible();
    await expect(missing).toContainText('Latest accounts');
    await expect(page.getByRole('button', { name: 'Submit application' })).toHaveCount(0);
    await missing.getByRole('link', { name: /Latest accounts/ }).click();
    await expect(chooser(page)).toBeAttached();
  });

  test('has a virus refused with nothing stored and no answer lost, then attaches a clean PDF', async ({
    pages,
  }) => {
    const page = await pages.applicant('applicant1');
    await page.goto(applicationPath());
    await page.getByRole('link', { name: 'Check your answers' }).first().click();
    await page
      .getByRole('region', { name: 'Before you can send your application' })
      .getByRole('link', { name: /Latest accounts/ })
      .click();

    await chooser(page).setInputFiles({
      name: INFECTED,
      mimeType: 'application/pdf',
      buffer: virusPdf(),
    });
    await scanned(
      page
        .getByRole('alert', { name: 'There is a problem' })
        .getByText(
          `${INFECTED}: This file has a virus in it, so it was not uploaded. Check the file and try again.`,
        ),
    ).toBeVisible();
    await expect(page.getByRole('list', { name: /^Files for / })).toHaveCount(0);

    // Nothing was stored, and the answers either side of the refusal are still there.
    const api = await signInApplicant('northfield', 'applicant1');
    const files = await api.ok<{ attachments: unknown[] }>(
      'GET',
      `/portal/applications/${need('application1Id')}/files`,
    );
    expect(files.attachments).toEqual([]);
    const saved = await api.ok<{ answers: Record<string, unknown> }>(
      'GET',
      `/portal/applications/${need('application1Id')}`,
    );
    expect(saved.answers[need('projectFieldId')]).toBe(
      'We will turn the old shed into a warm room for the garden club.',
    );
    expect(saved.answers[need('orgNameFieldId')]).toBe('Eastmere Community Garden');
    await api.dispose();

    await chooser(page).setInputFiles({
      name: CLEAN,
      mimeType: 'application/pdf',
      buffer: accountsPdf(),
    });
    await scanned(download(page)).toBeVisible();
    await page.reload();
    await expect(download(page)).toBeVisible();
  });

  test('checks the answers, submits, and sees "Submitted"', async ({ pages }) => {
    const page = await pages.applicant('applicant1');
    await page.goto(applicationPath());
    await page.getByRole('link', { name: 'Check your answers' }).first().click();
    await expect(h1(page, 'Check your answers')).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Before you can send your application' }),
    ).toHaveCount(0);
    await expect(download(page)).toBeVisible();
    await page.getByRole('button', { name: 'Submit application' }).click();
    await expect(h1(page, 'Application submitted')).toBeVisible();

    await page.goto('/northfield/applications');
    await expect(page.getByText('Submitted', { exact: true })).toBeVisible();
    const api = await signInApplicant('northfield', 'applicant1');
    expect((await applicationsOf(api)).map(({ status }) => status)).toEqual(['submitted']);
    await api.dispose();
  });

  test('@a11y the application pages have no axe violations', async ({ pages }) => {
    await axePages(await pages.applicant('applicant1'), [
      '/northfield/programmes',
      '/northfield/applications',
      applicationPath(),
      `${applicationPath()}/check`,
    ]);
  });
});
