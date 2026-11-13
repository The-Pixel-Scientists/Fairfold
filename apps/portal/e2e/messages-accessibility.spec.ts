// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Axe checks for the messages screen with no messages, with new messages and
// with a refused reply, at desktop width, at 320 px wide and at 200% zoom
// (ADR 0006), and at desktop width in the dark scheme, with the API stubbed. In
// portal-production they run under the production Content Security Policy,
// which the test fixture holds every page to.

import type { Page } from '@playwright/test';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import { APPLICATION_ID, sent, stubApply } from './apply-api.ts';
import { expectNoHorizontalScroll, expectNoViolations, variants } from './axe.ts';
import { message, stubMessages } from './messages-api.ts';
import type { MessagesStub } from './messages-api.ts';

const path = `/northfield/applications/${APPLICATION_ID}/messages`;

interface State {
  name: string;
  thread: () => MessagesStub;
  open: (page: Page) => Promise<void>;
}

const states: State[] = [
  {
    name: 'messages, none yet',
    thread: () => stubMessages(APPLICATION_ID),
    open: async (page) => {
      await page.goto(path);
      await expect(page.getByText(/There are no messages yet/)).toBeVisible();
    },
  },
  {
    name: 'messages, with new ones',
    thread: () =>
      stubMessages(
        APPLICATION_ID,
        message({ side: 'applicant', body: 'Can we change the start date?' }),
        message({ body: 'Yes, that is fine.', unread: true }),
        message({ body: 'Please send a bank letter.', unread: true }),
      ),
    open: async (page) => {
      await page.goto(path);
      await expect(page.getByText('You have 2 new messages.')).toBeVisible();
    },
  },
  {
    name: 'messages, a refused reply',
    thread: () => stubMessages(APPLICATION_ID),
    open: async (page) => {
      await page.goto(path);
      await page.getByRole('button', { name: 'Send message' }).click();
      await expect(page.getByRole('alert', { name: 'There is a problem' })).toBeFocused();
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
    test.describe.configure({ mode: 'parallel', timeout: 90_000 });

    for (const state of states) {
      test(`@a11y ${state.name} has no axe violations`, async ({ page }) => {
        await stubApply(page, {
          applications: [sent({ id: APPLICATION_ID })],
          more: state.thread().handlers,
        });
        await state.open(page);

        await expectNoViolations(page);
        await expectNoHorizontalScroll(page);
      });
    }
  });
}
