// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Staff notes and the applicant's message thread on a submission, in a real
// browser. The journeys and axe checks stub the API's answers
// (submission-notes-messages-api.ts) and run under the production content
// security policy in console-production; the axe checks run at desktop width,
// 320 px, 200% zoom and in the dark scheme. The @api journey runs against the
// real API (pnpm stack, then pnpm test:stack -- submission-notes-messages).

import { expect as strictExpect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { expectNoHorizontalScroll, expectNoViolations, variants } from './auth-axe.ts';
import { submission } from './grants-adjustments-api.ts';
import { nextCode } from './auth-totp.ts';
import { message, stubNotesAndMessages } from './submission-notes-messages-api.ts';
import type { NotesStubOptions } from './submission-notes-messages-api.ts';

/** Each page loads its code when it is first opened, which a busy machine or a development server's first compile can slow past five seconds. */
const expect = strictExpect.configure({ timeout: 15_000 });

const SUBMISSION = `/northfield/submissions/${submission.id}`;

const notes = (page: Page) => page.getByRole('region', { name: 'Notes' });
const messages = (page: Page) => page.getByRole('region', { name: 'Messages' });

async function openNotes(page: Page) {
  await page.goto(SUBMISSION);
  await page.getByRole('tab', { name: 'Notes' }).click();
  await expect(notes(page)).toBeVisible();
}

async function openMessages(page: Page) {
  await page.goto(SUBMISSION);
  await page.getByRole('tab', { name: 'Messages' }).click();
  await expect(messages(page)).toBeVisible();
}

async function pick(page: Page, typed: string, name: string) {
  const box = notes(page).getByRole('combobox', { name: /Mention people/ });
  await box.fill(typed);
  await page.getByRole('option', { name }).click();
}

test.describe('staff notes', () => {
  test('adds a note that mentions a colleague, and moves focus to it', async ({ page }) => {
    const stub = await stubNotesAndMessages(page);
    await openNotes(page);
    await expect(notes(page).getByText(/No notes have been added yet/)).toBeVisible();

    await notes(page)
      .getByRole('textbox', { name: /Note for staff only/ })
      .fill('Ask for the signed accounts.');
    await pick(page, 'pri', 'Priya Shah');
    await notes(page).getByRole('button', { name: 'Add note' }).click();

    const list = notes(page).getByRole('list', { name: 'Notes, newest first' });
    await expect(list).toContainText('Ask for the signed accounts.');
    await expect(list).toContainText('Mentioned: Priya Shah');
    await expect(list.getByRole('listitem').first()).toBeFocused();
    expect(stub.posted).toEqual([
      { body: 'Ask for the signed accounts.', mentions: ['00000000-0000-4000-8000-000000000012'] },
    ]);
    expect(page.url()).not.toContain('accounts');
    await expect(page).not.toHaveTitle(/accounts/);
  });

  test('keeps the body and the other people when a mention is refused', async ({ page }) => {
    const stub = await stubNotesAndMessages(page);
    stub.refuseMention = 1;
    await openNotes(page);

    await notes(page)
      .getByRole('textbox', { name: /Note for staff only/ })
      .fill('Please review.');
    await pick(page, 'pri', 'Priya Shah');
    await pick(page, 'tom', 'Tom Okafor');
    await notes(page).getByRole('button', { name: 'Add note' }).click();

    const chips = notes(page).getByRole('list', { name: 'People mentioned' });
    await expect(chips.getByRole('listitem').nth(1)).toContainText('cannot see this application');
    await expect(chips.getByRole('listitem').first()).not.toContainText('cannot see');
    const textbox = notes(page).getByRole('textbox', { name: /Note for staff only/ });
    await expect(textbox).toBeFocused();
    await expect(textbox).toHaveAccessibleDescription(/Remove the people who cannot see this/);
    await expect(
      chips.getByRole('button', { name: 'Remove Tom Okafor' }),
    ).toHaveAccessibleDescription(/cannot see this application/);
    await expect(notes(page).getByRole('textbox', { name: /Note for staff only/ })).toHaveValue(
      'Please review.',
    );
    await chips.getByRole('button', { name: 'Remove Tom Okafor' }).click();
    await notes(page).getByRole('button', { name: 'Add note' }).click();
    await expect(notes(page).getByRole('list', { name: 'Notes, newest first' })).toContainText(
      'Please review.',
    );
  });
});

test.describe('messages', () => {
  test('reads nothing until the section is opened, then clears the unread count', async ({
    page,
  }) => {
    const stub = await stubNotesAndMessages(page, {
      messages: [message(1), message(2, { unread: true })],
    });
    await page.goto(SUBMISSION);
    await expect(page.getByRole('tab', { name: 'Messages' })).toBeVisible();
    expect(stub.threadReads).toBe(0);

    await page.getByRole('tab', { name: 'Messages' }).click();
    await expect(messages(page).getByText('New', { exact: true })).toBeVisible();
    await expect(messages(page).getByText('No unread messages')).toBeVisible();
    // The development server's StrictMode runs each load effect twice, so a count would be 2 there.
    expect(stub.threadReads).toBeGreaterThan(0);
    expect(stub.markedRead).toBeGreaterThan(0);
  });

  test('replies to the applicant and moves focus to the reply', async ({ page }) => {
    await stubNotesAndMessages(page, { messages: [message(1)] });
    await openMessages(page);
    await expect(messages(page).getByText(/emailed that a message is waiting/)).toBeVisible();

    await messages(page)
      .getByRole('textbox', { name: 'Send message to applicant' })
      .fill('Thanks, we have your accounts.');
    await messages(page).getByRole('button', { name: 'Send message to applicant' }).click();

    const last = messages(page).getByRole('listitem').last();
    await expect(last).toContainText('From the funder: Ada Reed');
    await expect(last).toContainText('Thanks, we have your accounts.');
    await expect(last).toBeFocused();
    expect(page.url()).not.toContain('accounts');
  });
});

const note = {
  id: '00000000-0000-4000-8000-000000008001',
  body: 'A long synthetic note with https://example.org/a-very-long-address-that-must-wrap-at-narrow-widths.',
  author: { membershipId: '00000000-0000-4000-8000-000000000011', name: 'Ada Reed' },
  mentions: [],
  createdAt: '2026-10-22T11:00:00.000Z',
};

const states: {
  name: string;
  stub?: NotesStubOptions;
  open: (page: Page) => Promise<void>;
}[] = [
  { name: 'notes, empty', open: openNotes },
  {
    name: 'notes, with a note and the picker open',
    stub: { notes: [note] },
    open: async (page) => {
      await openNotes(page);
      await notes(page)
        .getByRole('combobox', { name: /Mention people/ })
        .focus();
      await page.keyboard.press('ArrowDown');
      await expect(page.getByRole('option', { name: 'Priya Shah' })).toBeVisible();
    },
  },
  {
    name: 'notes, with a refused note',
    open: async (page) => {
      await openNotes(page);
      await notes(page).getByRole('button', { name: 'Add note' }).click();
      await expect(notes(page).getByText(/Enter a note\./)).toBeVisible();
    },
  },
  { name: 'messages, empty', open: openMessages },
  {
    name: 'messages, unread',
    stub: { messages: [message(1), message(2, { unread: true }), message(3, { unread: true })] },
    open: async (page) => {
      await openMessages(page);
      await expect(messages(page).getByText('New', { exact: true })).toBeVisible();
    },
  },
  {
    name: 'messages, after a reply',
    stub: { messages: [message(1)] },
    open: async (page) => {
      await openMessages(page);
      await messages(page)
        .getByRole('textbox', { name: 'Send message to applicant' })
        .fill('Synthetic reply.');
      await messages(page).getByRole('button', { name: 'Send message to applicant' }).click();
      await expect(messages(page).getByText('Synthetic reply.')).toBeVisible();
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

    for (const state of states) {
      test(`@a11y ${state.name} has no axe violations`, async ({ page }) => {
        await stubNotesAndMessages(page, state.stub);
        await state.open(page);
        await expect(page.locator('h1')).toHaveCount(1);

        await expectNoViolations(page);
        await expectNoHorizontalScroll(page);
      });
    }
  });
}

const EMAIL = process.env['TPS_E2E_MANAGER_EMAIL'];
const PASSWORD = process.env['TPS_E2E_MANAGER_PASSWORD'];
const TOTP_KEY = process.env['TPS_E2E_MANAGER_TOTP_KEY'];

test.describe('notes and messages against the real API', () => {
  test.use({ ignoreHTTPSErrors: true });
  test.skip(
    process.env['TPS_E2E_STACK'] !== '1',
    'Runs against the stack: pnpm stack, then pnpm test:stack -- submission-notes-messages.',
  );
  test.skip(
    EMAIL === undefined || PASSWORD === undefined || TOTP_KEY === undefined,
    "Needs the seed's Northfield programme manager: set TPS_E2E_MANAGER_EMAIL, TPS_E2E_MANAGER_PASSWORD and TPS_E2E_MANAGER_TOTP_KEY.",
  );
  test.setTimeout(120_000);

  test('@api a manager adds a note that mentions a colleague and replies to the applicant', async ({
    page,
  }) => {
    await page.goto('/northfield/sign-in');
    await page.getByRole('textbox', { name: 'Email address', exact: true }).fill(EMAIL ?? '');
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD ?? '');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByLabel('Code from your app').fill(await nextCode(TOTP_KEY ?? '', null));
    await page.getByRole('button', { name: 'Confirm code' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Programmes' })).toBeVisible();

    await page.goto('/northfield/submissions');
    await page.getByRole('table').getByRole('link').first().click();
    await page.getByRole('tab', { name: 'Notes' }).click();
    await notes(page)
      .getByRole('textbox', { name: /Note for staff only/ })
      .fill('Synthetic note from the end-to-end run.');
    const box = notes(page).getByRole('combobox', { name: /Mention people/ });
    await box.focus();
    await page.keyboard.press('ArrowDown');
    if ((await page.getByRole('option').count()) > 0) {
      await page.keyboard.press('Enter');
      await expect(notes(page).getByRole('list', { name: 'People mentioned' })).toBeVisible();
    }
    await notes(page).getByRole('button', { name: 'Add note' }).click();
    await expect(notes(page).getByRole('list', { name: 'Notes, newest first' })).toContainText(
      'Synthetic note from the end-to-end run.',
    );

    await page.getByRole('tab', { name: 'Messages' }).click();
    await messages(page)
      .getByRole('textbox', { name: 'Send message to applicant' })
      .fill('Synthetic reply from the end-to-end run.');
    await messages(page).getByRole('button', { name: 'Send message to applicant' }).click();
    await expect(
      messages(page).getByRole('list', { name: 'Messages, oldest first' }),
    ).toContainText('Synthetic reply from the end-to-end run.');
  });
});
