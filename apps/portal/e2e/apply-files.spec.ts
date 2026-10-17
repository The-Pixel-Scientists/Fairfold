// SPDX-License-Identifier: AGPL-3.0-or-later
//
// An applicant attaching files while they fill in the form, in a real browser,
// with the API's answers stubbed (apply-api.ts, apply-files-api.ts): a file
// going up, being checked and joining the list, a refusal that keeps every
// other answer, a lost connection and a second try, removal, the check page,
// and that no file name goes anywhere but the upload's header. The same
// journey runs against the real API in apply-files-journey.spec.ts.

import type { Page, Request } from '@playwright/test';
import { fileRefusalMessages } from '@pixel-scientists/domain/files';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import { attachment } from './apply-files-api.ts';
import { APPLICATION_ID, completeAnswers, draft, filesForm, stubApply } from './apply-api.ts';
import type { ApplyOptions } from './apply-api.ts';
import { problem } from './auth-api.ts';

const SUFFIX = '– Fairfold Grants';
const home = `/northfield/applications/${APPLICATION_ID}`;
const documents = `${home}/sections/s_documents`;
const eligible = { f_charity: true };

/** The first screen of a test can take a while to build on a busy machine; the rest are quick. */
const slowly = expect.configure({ timeout: 20_000 });

const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });
const summary = (page: Page) => page.getByRole('alert', { name: 'There is a problem' });
const chooser = (page: Page) => page.locator('input#f_accounts');
const files = (page: Page) => page.getByRole('list', { name: 'Files for Your latest accounts' });
const saved = (page: Page) => page.getByText(/^Saved at \d/);

const pdf = (name: string) => ({
  name,
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.7 synthetic accounts'),
});

/** A draft with the documents section open to it, and the stub for it. */
async function openDocuments(page: Page, options: ApplyOptions = {}) {
  const stub = await stubApply(page, {
    form: filesForm,
    applications: [draft({ answers: eligible })],
    ...options,
  });
  await page.goto(documents);
  await slowly(h1(page, 'Documents')).toBeFocused();
  return stub;
}

test.describe('attaching a file', () => {
  test('shows what is accepted, then the file going up and being checked, then lists it with a link', async ({
    page,
  }) => {
    const stub = await openDocuments(page);
    await expect(page).toHaveTitle(`Section 4 of 4: Documents ${SUFFIX}`);
    await expect(page.getByText('Signed by a trustee.')).toBeVisible();
    await expect(
      page.getByText('PDF or Word document, up to 10 MB. You can attach up to 2 files.'),
    ).toBeVisible();

    const documentsAdded = page.getByRole('meter', { name: 'Documents added' });
    await expect(documentsAdded).toHaveAttribute('aria-valuetext', '0 of 2');
    await expect(
      page.getByText(
        'We save your answers as you type, and each file as soon as it uploads. You can leave at any time.',
      ),
    ).toBeVisible();
    const release = stub.hold();
    await chooser(page).setInputFiles(pdf('trustees report.pdf'));

    await expect(page.getByText('Uploading trustees report.pdf, 0%')).toBeVisible();
    await expect(
      page.getByRole('progressbar', { name: /^Uploading trustees report\.pdf/ }),
    ).toBeVisible();
    release();

    const link = files(page).getByRole('link', { name: /^Download trustees report\.pdf, PDF, / });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute(
      'href',
      new RegExp(`^/api/portal/applications/${APPLICATION_ID}/files/[0-9a-f-]{36}$`),
    );
    expect(stub.uploads).toEqual([
      {
        applicationId: APPLICATION_ID,
        fieldId: 'f_accounts',
        name: 'trustees report.pdf',
        bytes: pdf('x').buffer.length,
      },
    ]);
    await expect(documentsAdded).toHaveAttribute('aria-valuetext', '1 of 2');
    // Room for one more, so the way to add it is still there.
    await expect(chooser(page)).toBeAttached();
  });

  test('takes several files at once, one at a time, and says when the question is full', async ({
    page,
  }) => {
    const stub = await openDocuments(page);

    await chooser(page).setInputFiles([pdf('one.pdf'), pdf('two.pdf'), pdf('three.pdf')]);

    await expect(files(page).getByRole('link')).toHaveCount(2);
    await expect(
      summary(page).getByText(
        'three.pdf: This question takes up to 2 files. Remove a file to attach another.',
      ),
    ).toBeVisible();
    await expect(page.getByText(/^You have reached the limit of 2 files\./)).toBeVisible();
    await expect(chooser(page)).toHaveCount(0);
    expect(stub.uploads.map(({ name }) => name)).toEqual(['one.pdf', 'two.pdf']);
  });

  test('keeps every other answer when a file has a virus, and says what to do next', async ({
    page,
  }) => {
    const stub = await openDocuments(page);
    await page
      .getByRole('textbox', { name: /^Anything else/ })
      .fill('Our accounts were signed in September.');
    await expect(saved(page)).toBeVisible();
    stub.answer({ refuse: fileRefusalMessages.infected });

    await chooser(page).setInputFiles(pdf('accounts.pdf'));

    const words =
      'accounts.pdf: This file has a virus in it, so it was not uploaded. Check the file and try again.';
    await expect(summary(page)).toBeFocused();
    await expect(summary(page).getByText(words)).toBeVisible();
    await expect(page.getByText(words)).toHaveCount(2);
    await expect(files(page)).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: /^Anything else/ })).toHaveValue(
      'Our accounts were signed in September.',
    );
    expect(stub.applications[0]?.answers).toMatchObject({
      f_note: 'Our accounts were signed in September.',
    });

    // Another file can be chosen at once.
    await chooser(page).setInputFiles(pdf('clean-accounts.pdf'));
    await expect(
      files(page).getByRole('link', { name: /^Download clean-accounts\.pdf/ }),
    ).toBeVisible();
    await expect(summary(page)).toHaveCount(0);
  });

  test('shows the server’s words for a file of the wrong type', async ({ page }) => {
    const stub = await openDocuments(page);
    stub.answer({ refuse: fileRefusalMessages.type_not_allowed });

    await chooser(page).setInputFiles(pdf('accounts.pdf'));

    await expect(
      summary(page).getByText(`accounts.pdf: ${fileRefusalMessages.type_not_allowed}`),
    ).toBeVisible();
  });

  test('checks a file’s bytes before sending it, whatever its name says', async ({ page }) => {
    const stub = await openDocuments(page);

    await chooser(page).setInputFiles({
      name: 'accounts.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('This is not a PDF.'),
    });

    await expect(
      summary(page).getByText('accounts.pdf: The file must be a PDF or Word document.'),
    ).toBeVisible();
    expect(stub.uploads).toEqual([]);
  });

  test('says when the connection fails, and a second try works', async ({ page }) => {
    const stub = await openDocuments(page);
    stub.answer('drop');

    await chooser(page).setInputFiles(pdf('accounts.pdf'));

    await expect(
      summary(page).getByText(
        'accounts.pdf: We could not reach the service. Check your connection and try again.',
      ),
    ).toBeVisible();
    await chooser(page).setInputFiles(pdf('accounts.pdf'));

    await expect(files(page).getByRole('link', { name: /^Download accounts\.pdf/ })).toBeVisible();
    await expect(summary(page)).toHaveCount(0);
    expect(stub.uploads).toHaveLength(2);
  });

  test('keeps saving other answers while a file is on its way', async ({ page }) => {
    const stub = await openDocuments(page);
    const release = stub.hold();
    await chooser(page).setInputFiles(pdf('accounts.pdf'));
    await expect.poll(() => stub.uploads.length).toBe(1);

    await page.getByRole('textbox', { name: /^Anything else/ }).fill('Signed in September.');

    await expect
      .poll(() => stub.applications[0]?.answers)
      .toMatchObject({
        f_note: 'Signed in September.',
      });
    await expect(page.getByText('Uploading accounts.pdf, 0%')).toBeVisible();
    release();
    await expect(files(page).getByRole('link', { name: /^Download accounts\.pdf/ })).toBeVisible();
    // The answers carry no file: the API takes a file only through its own route.
    expect(JSON.stringify(stub.applications[0]?.answers)).not.toContain(
      stub.files[APPLICATION_ID]?.[0]?.id ?? 'no file',
    );
  });

  test('asks before leaving while a file is uploading', async ({ page }) => {
    const stub = await openDocuments(page);
    const release = stub.hold();
    await chooser(page).setInputFiles(pdf('accounts.pdf'));
    await expect.poll(() => stub.uploads.length).toBe(1);

    await page.getByRole('link', { name: 'Community Spaces Fund, Spring 2027' }).click();

    const dialog = page.getByRole('dialog', { name: 'Leave this page?' });
    await expect(
      dialog.getByText('A file is still uploading. If you leave this page, it will not be added.'),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Stay on this page' }).click();
    await expect(h1(page, 'Documents')).toBeVisible();
    release();
    await expect(files(page).getByRole('link', { name: /^Download accounts\.pdf/ })).toBeVisible();

    await page.getByRole('link', { name: 'Community Spaces Fund, Spring 2027' }).click();
    await expect(h1(page, 'Your application')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

test.describe('files already attached', () => {
  const options = {
    applications: [draft({ answers: eligible })],
    files: { [APPLICATION_ID]: [attachment()] },
  };

  test('lists them with a link each, and removes one, moving focus to the way to attach another', async ({
    page,
  }) => {
    const stub = await openDocuments(page, options);
    await expect(
      files(page).getByRole('link', { name: 'Download accounts-2026.pdf, PDF, 2.1 MB' }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Remove accounts-2026.pdf' }).click();

    await expect(files(page)).toHaveCount(0);
    await expect(chooser(page)).toBeFocused();
    expect(stub.files[APPLICATION_ID]).toEqual([]);
  });

  test('says so when a file cannot be removed, and keeps it', async ({ page }) => {
    await openDocuments(page, options);
    await page.route(/\/files\/[^/]+$/, (route) =>
      route.request().method() === 'DELETE'
        ? route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify(problem(503, 'Busy.').body),
          })
        : route.fallback(),
    );

    await page.getByRole('button', { name: 'Remove accounts-2026.pdf' }).click();

    await expect(
      page.getByText('We could not remove the file. Check your connection and try again.'),
    ).toBeVisible();
    await expect(
      files(page).getByRole('link', { name: /^Download accounts-2026\.pdf/ }),
    ).toBeVisible();
  });

  test('are there on a later visit', async ({ page }) => {
    await openDocuments(page, options);
    await page.goto(home);
    await page.goto(documents);

    await expect(
      files(page).getByRole('link', { name: /^Download accounts-2026\.pdf/ }),
    ).toBeVisible();
  });
});

test.describe('check your answers', () => {
  test('lists a missing required file with a link to its question, then offers to submit once it is attached', async ({
    page,
  }) => {
    const stub = await stubApply(page, {
      form: filesForm,
      applications: [draft({ answers: completeAnswers })],
    });
    await page.goto(`${home}/check`);

    const missing = page.getByRole('region', { name: 'Before you can send your application' });
    await expect(missing).toBeVisible();
    await expect(page.getByRole('button', { name: 'Submit application' })).toHaveCount(0);
    await missing
      .getByRole('link', { name: 'Your latest accounts: Upload a file for this question.' })
      .click();
    await expect(h1(page, 'Documents')).toBeVisible();
    await expect(chooser(page)).toBeFocused();

    await chooser(page).setInputFiles(pdf('accounts.pdf'));
    await expect(files(page).getByRole('link', { name: /^Download accounts\.pdf/ })).toBeVisible();
    await page.getByRole('button', { name: 'Save and check your answers' }).click();

    await expect(h1(page, 'Check your answers')).toBeVisible();
    await expect(missing).toHaveCount(0);
    await expect(
      page.getByRole('link', { name: /^Download accounts\.pdf, PDF, / }),
    ).toHaveAttribute('href', /\/files\/[0-9a-f-]{36}$/);
    await page.getByRole('button', { name: 'Submit application' }).click();

    await expect(h1(page, 'Application submitted')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Files you sent' })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Download accounts\.pdf/ })).toBeVisible();
    expect(stub.applications[0]?.status).toBe('submitted');
    expect(stub.files[APPLICATION_ID]).toHaveLength(1);
  });

  test('reads a file question back with its files, and with no file says so', async ({ page }) => {
    await stubApply(page, {
      form: filesForm,
      applications: [draft({ answers: completeAnswers })],
      files: { [APPLICATION_ID]: [attachment()] },
    });
    await page.goto(`${home}/check`);

    const documentsAnswers = page
      .getByRole('heading', { level: 2, name: 'Documents' })
      .locator('xpath=..');
    await expect(documentsAnswers.getByText('Your latest accounts')).toBeVisible();
    await expect(
      documentsAnswers.getByRole('link', { name: 'Download accounts-2026.pdf, PDF, 2.1 MB' }),
    ).toBeVisible();
    await expect(documentsAnswers.getByText('Not answered')).toHaveCount(2);
  });
});

test.describe('file names', () => {
  test('go in the upload’s header only: never in an address, a title or another request', async ({
    page,
  }) => {
    const requests: Request[] = [];
    page.on('request', (request) => requests.push(request));
    const NAME = 'ada-lovelace-payslip.pdf';
    const stub = await openDocuments(page, {
      applications: [draft({ answers: completeAnswers })],
    });

    await chooser(page).setInputFiles(pdf(NAME));
    await expect(
      files(page).getByRole('link', { name: new RegExp(`^Download ${NAME}`) }),
    ).toBeVisible();
    await page.getByRole('textbox', { name: /^Anything else/ }).fill('Signed in September.');
    await expect(saved(page)).toBeVisible();
    await page.getByRole('button', { name: 'Save and check your answers' }).click();
    await expect(h1(page, 'Check your answers')).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(`^Download ${NAME}`) })).toBeVisible();

    const named = (text: string | null) => /lovelace|payslip/i.test(decodeURIComponent(text ?? ''));
    expect(stub.uploads.map(({ name }) => name)).toEqual([NAME]);
    for (const request of requests) {
      expect(named(request.url()), request.url()).toBe(false);
      if (!request.url().endsWith('/files') || request.method() !== 'POST') {
        expect(named(request.postData()), request.url()).toBe(false);
      }
      const headers = await request.allHeaders();
      const inHeader = Object.entries(headers).filter(([, value]) => named(value));
      expect(inHeader.map(([header]) => header)).toEqual(
        request.method() === 'POST' && request.url().endsWith('/files') ? ['file-name'] : [],
      );
    }
    expect(named(page.url())).toBe(false);
    expect(named(await page.title())).toBe(false);
  });
});
