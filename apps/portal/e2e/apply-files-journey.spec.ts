// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Files in the apply journey against the real API: an applicant fills in the
// form up to its documents, is refused a file with a virus in it and keeps the
// rest, attaches a PDF, sees it on the check page and after sending, and no
// file name goes anywhere but the upload's header. It needs the stack, seeded
// with the published Community Spaces Fund form, with its documents question:
// `pnpm stack`, then `pnpm test:stack -- apply-files`.

import { readFile } from 'node:fs/promises';

import type { Page } from '@playwright/test';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import {
  answerQuestions,
  createApplicant,
  h1,
  passEligibility,
  startApplication,
} from './apply-steps.ts';

/**
 * The EICAR antivirus test string, made here from two halves so that no file
 * on disk holds it, where antivirus software would quarantine the file. A PDF
 * header goes first, so the server finds a type it takes and the scanner,
 * not the type check, refuses it.
 */
const virus = (): Buffer =>
  Buffer.from(
    [
      '%PDF-1.7\n',
      'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR',
      '-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
    ].join(''),
  );

/** A small PDF made up for the test. */
const pdf = (): Buffer =>
  Buffer.from(
    [
      '%PDF-1.4',
      '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
      '2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj',
      'trailer<</Root 1 0 R>>',
      '%%EOF',
    ].join('\n'),
  );

const CLEAN = 'accounts-2026.pdf';
const INFECTED = 'invoice-from-ada.pdf';

const chooser = (page: Page) => page.locator('input[type="file"]');
const link = (page: Page) => page.getByRole('link', { name: new RegExp(`^Download ${CLEAN}`) });
/** The scan takes a few seconds, and the first after the stack starts loads the signatures. */
const scanned = expect.configure({ timeout: 90_000 });

/** Opens the link and says what it saved: the file's name and its first bytes. */
async function download(page: Page): Promise<{ name: string; start: string }> {
  const [saved] = await Promise.all([page.waitForEvent('download'), link(page).click()]);
  const path = await saved.path();
  return { name: saved.suggestedFilename(), start: (await readFile(path)).toString().slice(0, 5) };
}

test.describe('files in an application, against the real API', () => {
  test.skip(
    process.env['TPS_E2E_STACK'] !== '1',
    'Runs against the stack: pnpm stack, then pnpm test:stack -- apply-files.',
  );
  test.setTimeout(300_000);

  test('@api refuses a virus, keeps the rest, attaches a PDF, and shows it when checking and after sending', async ({
    page,
  }) => {
    const addresses: string[] = [];
    page.on('request', (request) => addresses.push(decodeURIComponent(request.url())));
    await createApplicant(page);
    await startApplication(page);
    await passEligibility(page);

    // Every section up to the documents is answered, the budget included.
    await page.getByRole('link', { name: /^Continue with / }).click();
    for (;;) {
      await expect(page.getByText(/^Section \d+ of \d+/)).toBeVisible();
      if ((await h1(page, 'Documents').count()) > 0) break;
      await answerQuestions(page);
      await expect(page.getByText(/^Saved at \d/)).toBeVisible();
      await page.getByRole('button', { name: 'Save and continue' }).click();
    }

    // A file with a virus in it is refused, with what to do next, and nothing is attached.
    await chooser(page).setInputFiles({
      name: INFECTED,
      mimeType: 'application/pdf',
      buffer: virus(),
    });
    const problem = page.getByRole('alert', { name: 'There is a problem' });
    await scanned(
      problem.getByText(
        `${INFECTED}: This file has a virus in it, so it was not uploaded. Check the file and try again.`,
      ),
    ).toBeVisible();
    await expect(page.getByRole('list', { name: /^Files for / })).toHaveCount(0);

    // A clean PDF is checked and joins the list, and is still there on a fresh page.
    await chooser(page).setInputFiles({ name: CLEAN, mimeType: 'application/pdf', buffer: pdf() });
    await scanned(link(page)).toBeVisible();
    await page.reload();
    await expect(link(page)).toBeVisible();

    // The check page lists it, offers to submit, and the link downloads it.
    await page.getByRole('button', { name: 'Save and check your answers' }).click();
    await expect(h1(page, 'Check your answers')).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Before you can send your application' }),
    ).toHaveCount(0);
    await expect(link(page)).toBeVisible();
    expect(await download(page)).toEqual({ name: CLEAN, start: '%PDF-' });
    await page.getByRole('button', { name: 'Submit application' }).click();

    // After sending, the file is listed and still downloads.
    await expect(h1(page, 'Application submitted')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Files you sent' })).toBeVisible();
    expect(await download(page)).toEqual({ name: CLEAN, start: '%PDF-' });

    // Names went in the upload's header only, never in an address.
    expect(addresses.filter((address) => /accounts-2026|invoice-from-ada/i.test(address))).toEqual(
      [],
    );
  });
});
