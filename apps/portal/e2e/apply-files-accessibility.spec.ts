// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Axe checks for every state of a file question and the pages that show files,
// at desktop width, at 320 px wide and at 200% zoom (ADR 0006), and at desktop
// width in the dark scheme, with the API stubbed (apply-api.ts,
// apply-files-api.ts). In portal-production they run under the production
// Content Security Policy, which the test fixture holds every page to.

// The init script below runs in the browser, so it uses DOM types.
/// <reference lib="dom" />

import type { Page } from '@playwright/test';
import { fileRefusalMessages } from '@pixel-scientists/domain/files';
import type { Answers } from '@pixel-scientists/domain/forms';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import { APPLICATION_ID, completeAnswers, draft, filesForm, stubApply } from './apply-api.ts';
import type { ApplyOptions, ApplyStub } from './apply-api.ts';
import { attachment } from './apply-files-api.ts';
import { problem } from './auth-api.ts';
import { expectNoHorizontalScroll, expectNoViolations, variants } from './axe.ts';

/** A name long enough to test that nothing runs off a 320 px screen. */
const LONG_NAME = `${'accounts-for-the-year-'.repeat(6)}2026.pdf`;

const home = `/northfield/applications/${APPLICATION_ID}`;
const documents = `${home}/sections/s_documents`;
const eligible = { f_charity: true };

const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });
const summary = (page: Page) => page.getByRole('alert', { name: 'There is a problem' });
const chooser = (page: Page) => page.locator('input#f_accounts');

const pdf = (name = 'accounts.pdf') => ({
  name,
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.7 synthetic accounts'),
});

const two = [
  attachment(),
  attachment({ id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', name: LONG_NAME }),
];
const withFiles = (files = [attachment()], answers: Answers = eligible): ApplyOptions => ({
  form: filesForm,
  applications: [draft({ answers })],
  files: { [APPLICATION_ID]: files },
});
const without: ApplyOptions = { form: filesForm, applications: [draft({ answers: eligible })] };

interface State {
  name: string;
  options?: ApplyOptions;
  /** Opens the screen and gets it into the state, and waits until it is showing. */
  open: (page: Page, stub: ApplyStub) => Promise<void>;
}

/** The first screen of a test can take a while to build on a busy machine; the rest are quick. */
const slowly = expect.configure({ timeout: 20_000 });

/** Opens the documents section, and waits for it. */
const section = async (page: Page) => {
  await page.goto(documents);
  await slowly(h1(page, 'Documents')).toBeVisible();
  await expect(page.getByText(/^Loading/)).toHaveCount(0);
};

/** A browser whose uploads send every byte and then wait for the virus check, which the API never answers. */
async function checking(page: Page) {
  await page.addInitScript(() => {
    class Checking extends XMLHttpRequest {
      override send(body: File): void {
        this.upload.onprogress?.call(this, new ProgressEvent('progress', { loaded: body.size }));
      }
    }
    window.XMLHttpRequest = Checking;
  });
}

const states: State[] = [
  { name: 'a file question with no file', options: without, open: section },
  { name: 'a file question with a file attached', options: withFiles(), open: section },
  {
    name: 'a file question at its limit, with a long file name',
    options: withFiles(two),
    open: async (page) => {
      await section(page);
      await expect(page.getByText(/^You have reached the limit of 2 files\./)).toBeVisible();
    },
  },
  {
    name: 'a file going up',
    options: without,
    open: async (page, stub) => {
      stub.hold();
      await section(page);
      await chooser(page).setInputFiles(pdf(LONG_NAME));
      await expect(page.getByRole('progressbar')).toBeVisible();
    },
  },
  {
    name: 'a file being checked for viruses',
    options: without,
    open: async (page) => {
      await checking(page);
      await section(page);
      await chooser(page).setInputFiles(pdf(LONG_NAME));
      await expect(page.getByText(/^Checking .* for viruses$/).first()).toBeVisible();
    },
  },
  {
    name: 'a file refused for a virus',
    options: without,
    open: async (page, stub) => {
      stub.answer({ refuse: fileRefusalMessages.infected });
      await section(page);
      await chooser(page).setInputFiles(pdf(LONG_NAME));
      await expect(summary(page)).toBeFocused();
    },
  },
  {
    name: 'a file refused for its type',
    options: without,
    open: async (page, stub) => {
      stub.answer({ refuse: fileRefusalMessages.type_not_allowed });
      await section(page);
      await chooser(page).setInputFiles(pdf());
      await expect(summary(page)).toBeFocused();
    },
  },
  {
    name: 'a file the browser refuses before it is sent',
    options: without,
    open: async (page) => {
      await section(page);
      await chooser(page).setInputFiles({
        name: 'accounts.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('This is not a PDF.'),
      });
      await expect(summary(page)).toBeFocused();
    },
  },
  {
    name: 'too many files chosen at once',
    options: without,
    open: async (page) => {
      await section(page);
      await chooser(page).setInputFiles([pdf('one.pdf'), pdf('two.pdf'), pdf('three.pdf')]);
      await expect(summary(page).getByText(/takes up to 2 files/)).toBeVisible();
    },
  },
  {
    name: 'a file lost to a dropped connection',
    options: without,
    open: async (page, stub) => {
      stub.answer('drop');
      await section(page);
      await chooser(page).setInputFiles(pdf());
      await expect(summary(page)).toBeFocused();
    },
  },
  {
    name: 'a file that could not be removed',
    options: withFiles(),
    open: async (page) => {
      await page.route(/\/files\/[^/]+$/, (route) =>
        route.request().method() === 'DELETE'
          ? route.fulfill({
              status: 503,
              contentType: 'application/json',
              body: JSON.stringify(problem(503, 'Busy.').body),
            })
          : route.fallback(),
      );
      await section(page);
      await page.getByRole('button', { name: 'Remove accounts-2026.pdf' }).click();
      await expect(page.getByRole('alert')).toContainText('We could not remove the file.');
    },
  },
  {
    name: 'a file question, when the files could not be loaded',
    options: {
      ...without,
      more: { [`GET /portal/applications/${APPLICATION_ID}/files`]: problem(503, 'Busy.') },
    },
    open: async (page) => {
      await page.goto(documents);
      await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    },
  },
  {
    name: 'the application, with the documents to do',
    options: withFiles([], completeAnswers),
    open: async (page) => {
      await page.goto(home);
      await expect(page.getByText('Not started', { exact: true })).toBeVisible();
    },
  },
  {
    name: 'check your answers, with a file to add',
    options: { ...without, applications: [draft({ answers: completeAnswers })] },
    open: async (page) => {
      await page.goto(`${home}/check`);
      await expect(
        page.getByRole('region', { name: 'Before you can send your application' }),
      ).toContainText('Your latest accounts: Upload a file for this question.');
    },
  },
  {
    name: 'check your answers, with files, ready to submit',
    options: withFiles(two, completeAnswers),
    open: async (page) => {
      await page.goto(`${home}/check`);
      await expect(page.getByRole('button', { name: 'Submit application' })).toBeVisible();
      await expect(page.getByRole('link', { name: /^Download accounts-2026\.pdf/ })).toBeVisible();
    },
  },
  {
    name: 'application submitted, with its files',
    options: {
      ...withFiles(two, completeAnswers),
      applications: [draft({ answers: completeAnswers, status: 'submitted' })],
    },
    open: async (page) => {
      await page.goto(`${home}/submitted`);
      await expect(page.getByRole('heading', { level: 2, name: 'Files you sent' })).toBeVisible();
    },
  },
];

for (const variant of variants) {
  test.describe(`at ${variant.name}`, () => {
    test.use({
      viewport: variant.viewport,
      deviceScaleFactor: variant.deviceScaleFactor,
      colorScheme: variant.scheme,
    });
    // Axe reads a whole page, and a slow browser on a busy machine needs time to do it.
    test.describe.configure({ mode: 'parallel', timeout: 90_000 });

    for (const state of states) {
      test(`@a11y ${state.name} has no axe violations`, async ({ page }) => {
        const stub = await stubApply(page, state.options);
        await state.open(page, stub);

        await expectNoViolations(page);
        await expectNoHorizontalScroll(page);
      });
    }
  });
}

test.describe('with reduced motion and forced colours', () => {
  test.use({ viewport: { width: 320, height: 640 } });
  test.describe.configure({ timeout: 90_000 });

  test('@a11y a file question with a file has no axe violations', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' });
    await stubApply(page, withFiles(two));
    await section(page);

    await expectNoViolations(page);
    await expectNoHorizontalScroll(page);
  });
});

test.describe('while a control has focus', () => {
  test.describe.configure({ timeout: 90_000 });

  test('@a11y the controls of a file question have no axe violations', async ({ page }) => {
    await stubApply(page, withFiles());
    await section(page);

    for (const control of [
      page.getByRole('link', { name: /^Download accounts-2026\.pdf/ }),
      page.getByRole('button', { name: 'Remove accounts-2026.pdf' }),
      chooser(page),
      page.getByRole('button', { name: 'Save and check your answers' }),
    ]) {
      await control.focus();
      await expect(control).toBeFocused();
      await expectNoViolations(page);
    }
  });
});
