// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A programme manager downloads an applicant's file, against the real API: an
// applicant attaches a PDF to their application and sends it, the manager
// opens the submission and downloads the file, and the response is an
// attachment that the browser may not sniff. It needs the stack, seeded with
// the published Community Spaces Fund form (`pnpm stack`, then
// `pnpm test:stack -- submissions-files`), ClamAV, which scans the upload, and
// the manager's details that programme-journey.spec.ts uses, with the
// authenticator key set up by an earlier run. If an
// administrator's details are set too (TPS_E2E_ADMIN_EMAIL,
// TPS_E2E_ADMIN_PASSWORD and TPS_E2E_ADMIN_TOTP_KEY), it also reads the audit
// log for the download's event. The stub of submissions-files.spec.ts runs the
// same screens without the stack.

import { readFile } from 'node:fs/promises';

import type { Browser, Page } from '@playwright/test';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import {
  answerQuestions,
  createApplicant,
  h1,
  passEligibility,
  startApplication,
} from './submissions-files-apply.ts';
import { nextCode } from './auth-totp.ts';

const NAME = 'accounts-2026.pdf';
const EMAIL = process.env['TPS_E2E_MANAGER_EMAIL'];
const PASSWORD = process.env['TPS_E2E_MANAGER_PASSWORD'];
const TOTP_KEY = process.env['TPS_E2E_MANAGER_TOTP_KEY'];
const ADMIN_EMAIL = process.env['TPS_E2E_ADMIN_EMAIL'];
const ADMIN_PASSWORD = process.env['TPS_E2E_ADMIN_PASSWORD'];
const ADMIN_TOTP_KEY = process.env['TPS_E2E_ADMIN_TOTP_KEY'];

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

/** The scan takes a few seconds, and the first after the stack starts loads the signatures. */
const scanned = expect.configure({ timeout: 90_000 });

/** A new applicant attaches a PDF to the documents question, sends the application, and gives the submission's id. */
async function applyWithFile(browser: Browser): Promise<string> {
  const context = await browser.newContext({ baseURL: process.env['TPS_E2E_PORTAL_URL'] });
  const page = await context.newPage();
  await createApplicant(page);
  await startApplication(page);
  await passEligibility(page);

  await page.getByRole('link', { name: /^Continue with / }).click();
  for (;;) {
    await expect(page.getByText(/^Section \d+ of \d+/)).toBeVisible();
    if ((await h1(page, 'Documents').count()) > 0) break;
    await answerQuestions(page);
    await expect(page.getByText(/^Saved at \d/)).toBeVisible();
    await page.getByRole('button', { name: 'Save and continue' }).click();
  }
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: NAME, mimeType: 'application/pdf', buffer: pdf() });
  await scanned(page.getByRole('link', { name: new RegExp(`^Download ${NAME}`) })).toBeVisible();
  await page.getByRole('button', { name: 'Save and check your answers' }).click();
  await expect(h1(page, 'Check your answers')).toBeVisible();
  await page.getByRole('button', { name: 'Submit application' }).click();
  await expect(h1(page, 'Application submitted')).toBeVisible();
  const id = new URL(page.url()).pathname.split('/')[3] ?? '';
  await context.close();
  return id;
}

/** Signs in as the programme manager with the authenticator app's key, which the first run of another journey sets up. */
async function signInAsManager(page: Page): Promise<void> {
  await page.goto('/northfield/sign-in');
  await page.getByRole('textbox', { name: 'Email address' }).fill(EMAIL ?? '');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(h1(page, 'Enter your code')).toBeVisible();
  await page.getByLabel('Code from your app').fill(await nextCode(TOTP_KEY ?? '', null));
  await page.getByRole('button', { name: 'Confirm code' }).click();
  await expect(h1(page, 'Programmes')).toBeVisible();
}

/** The audit events of a file's downloads, read as the administrator, or null when no administrator is set up. */
async function downloadEvents(browser: Browser, origin: string, fileId: string) {
  if (ADMIN_EMAIL === undefined || ADMIN_PASSWORD === undefined || ADMIN_TOTP_KEY === undefined) {
    return null;
  }
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${origin}/northfield/sign-in`);
  const send = async (path: string, body: unknown) =>
    page.request.post(`${origin}/api${path}`, { data: body });
  expect(
    (
      await send('/auth/tenants/northfield/sign-in', {
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
      })
    ).ok(),
  ).toBe(true);
  const code = await nextCode(ADMIN_TOTP_KEY, null);
  expect((await send('/auth/totp/verify', { code })).ok()).toBe(true);
  const events = await page.request.get(
    `${origin}/api/console/audit-events?action=platform.file.downloaded&entityId=${fileId}`,
  );
  expect(events.ok()).toBe(true);
  const { events: found } = (await events.json()) as { events: unknown[] };
  return found;
}

test.describe('downloading an applicant’s file against the real API', () => {
  test.skip(
    process.env['TPS_E2E_STACK'] !== '1',
    'Runs against the stack: pnpm stack, then pnpm test:stack -- submissions-files.',
  );
  test.skip(
    EMAIL === undefined || PASSWORD === undefined || TOTP_KEY === undefined,
    "Needs the seed's Northfield programme manager: set TPS_E2E_MANAGER_EMAIL, TPS_E2E_MANAGER_PASSWORD and TPS_E2E_MANAGER_TOTP_KEY.",
  );
  test.setTimeout(420_000);

  test('@api a manager downloads the file as an attachment the browser may not sniff, and the download is audited', async ({
    page,
    browser,
  }) => {
    const submissionId = await applyWithFile(browser);
    await signInAsManager(page);
    const origin = new URL(page.url()).origin;

    await page.goto(`/northfield/submissions/${submissionId}`);
    const link = page
      .getByRole('tabpanel', { name: 'Application' })
      .getByRole('link', { name: new RegExp(`^Download ${NAME}, PDF, `) });
    await expect(link).toBeVisible();

    const href = (await link.getAttribute('href')) ?? '';
    const fileId = href.split('/').at(-1) ?? '';
    expect(href).toBe(`/api/console/submissions/${submissionId}/files/${fileId}`);

    const [saved] = await Promise.all([page.waitForEvent('download'), link.click()]);
    expect(saved.suggestedFilename()).toBe(NAME);
    expect((await readFile(await saved.path())).toString().slice(0, 5)).toBe('%PDF-');

    const sent = await page.request.get(`${origin}${href}`);
    expect(sent.status()).toBe(200);
    expect(sent.headers()['content-disposition']).toMatch(/^attachment;/);
    expect(sent.headers()['x-content-type-options']).toBe('nosniff');
    expect(sent.headers()['content-type']).toBe('application/pdf');

    const events = await downloadEvents(browser, origin, fileId);
    if (events === null) {
      test.info().annotations.push({
        type: 'note',
        description: 'The audit event was not read: no administrator is set up for this run.',
      });
    } else {
      expect(events.length).toBeGreaterThanOrEqual(2);
    }
  });
});
