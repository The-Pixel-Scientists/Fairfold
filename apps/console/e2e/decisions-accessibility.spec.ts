// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Axe checks for every decision screen, dialog and state, at desktop width, at
// 320 px wide and at 200% zoom (ADR 0006), and at desktop width in the dark
// scheme, with the API's answers stubbed (decisions-api.ts). In
// console-production they run under the production content security policy.

import { expect as strictExpect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { problem } from './auth-api.ts';
import { expectNoHorizontalScroll, expectNoViolations, variants } from './auth-axe.ts';
import { decide, ids, stubDecisions } from './decisions-api.ts';
import type { DecisionOptions, DecisionStub } from './decisions-api.ts';
import { decisionRows } from './decisions-steps.ts';
import { confirmItsYou } from './team-steps.ts';

/** Each page loads its code when it is first opened, which a busy machine or a development server's first compile can slow past five seconds. */
const expect = strictExpect.configure({ timeout: 15_000 });

const DECISIONS = `/northfield/rounds/${ids.round}/decisions`;
const RELEASE = `/northfield/rounds/${ids.round}/decisions/release`;

/** A request that is never answered, so the page stays on its loading state. */
async function neverAnswer(page: Page, path: string): Promise<void> {
  await page.route(
    (url) => url.pathname === path,
    () => undefined,
  );
}

interface State {
  name: string;
  options?: DecisionOptions;
  /** Records decisions and changes the API's answers for this state. */
  prepare?: (stub: DecisionStub, page: Page) => Promise<void> | void;
  /** Opens the screen and gets it into the state, and waits until it is showing. */
  open: (page: Page, stub: DecisionStub) => Promise<void>;
}

/** Three decisions made, as a panel would have recorded them. */
function mixed(stub: DecisionStub): void {
  decide(stub, 0, 'accepted');
  decide(stub, 1, 'waitlisted');
  decide(stub, 2, 'declined');
}

async function openList(page: Page): Promise<void> {
  await page.goto(DECISIONS);
  await expect(decisionRows(page)).toHaveCount(6);
}

async function openRecordDialog(page: Page): Promise<void> {
  await openList(page);
  await decisionRows(page)
    .filter({ hasText: 'No decision yet' })
    .first()
    .getByRole('button', { name: /^Record decision/ })
    .click();
  await expect(page.getByRole('dialog', { name: 'Record decision' })).toBeVisible();
}

async function openBulkDialog(page: Page): Promise<void> {
  await openList(page);
  await decisionRows(page).nth(3).getByRole('checkbox').check();
  await decisionRows(page).nth(4).getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Record decisions' }).click();
  await expect(page.getByRole('dialog', { name: 'Record decisions' })).toBeVisible();
}

async function openReleaseWithTheBoxTicked(page: Page): Promise<void> {
  await page.goto(RELEASE);
  await expect(page.getByRole('group', { name: 'Decisions to release' })).toBeVisible();
  await expect(page.getByText('Community Spaces Fund: we are offering you a grant')).toBeVisible();
  await page.getByRole('checkbox', { name: /I have checked the summary/ }).check();
}

const states: State[] = [
  {
    name: 'the decisions page',
    prepare: mixed,
    open: openList,
  },
  {
    name: 'the decisions page with decisions released',
    prepare: (stub) => {
      decide(stub, 0, 'accepted', { released: true });
      decide(stub, 1, 'waitlisted', { released: true });
      decide(stub, 2, 'declined', { released: true });
    },
    open: openList,
  },
  {
    name: 'the decisions page when the awards are over the budget',
    options: { budget: 20_000 },
    prepare: (stub) => {
      decide(stub, 0, 'accepted', { pounds: 15_000 });
      decide(stub, 1, 'accepted', { pounds: 15_000 });
    },
    open: async (page) => {
      await openList(page);
      await expect(page.getByText("The awards are over the round's budget")).toBeVisible();
    },
  },
  {
    name: 'the decisions page with one outcome shown',
    prepare: mixed,
    open: async (page) => {
      await openList(page);
      await page.getByRole('button', { name: /^Declined/ }).click();
      await expect(decisionRows(page)).toHaveCount(1);
    },
  },
  {
    name: 'the decisions page with an outcome nobody has',
    open: async (page) => {
      await openList(page);
      await page.getByRole('button', { name: /^Accepted/ }).click();
      await expect(
        page.getByRole('heading', { level: 2, name: 'No submissions here' }),
      ).toBeVisible();
    },
  },
  {
    name: 'the decisions page with rows chosen',
    prepare: mixed,
    open: async (page) => {
      await openList(page);
      await page.getByRole('checkbox', { name: 'Select all on this page' }).check();
      await expect(page.getByRole('group', { name: 'Bulk actions' })).toContainText(
        '6 submissions selected',
      );
    },
  },
  {
    name: 'the decisions page with one row focused',
    open: async (page) => {
      await openList(page);
      await decisionRows(page).nth(1).focus();
      await expect(decisionRows(page).nth(1)).toBeFocused();
    },
  },
  {
    name: 'the keyboard shortcuts',
    open: async (page) => {
      await openList(page);
      await decisionRows(page).first().focus();
      await page.keyboard.press('?');
      await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
    },
  },
  {
    name: 'the dialog for recording a decision',
    open: openRecordDialog,
  },
  {
    name: 'the dialog for recording an award',
    open: async (page) => {
      await openRecordDialog(page);
      await page.getByRole('radio', { name: /^Accepted/ }).check();
      await expect(page.getByLabel('Amount to award')).toBeVisible();
    },
  },
  {
    name: 'the dialog for recording a decision with mistakes in it',
    open: async (page) => {
      await openRecordDialog(page);
      await page.getByRole('radio', { name: /^Accepted/ }).check();
      await page.getByLabel('Amount to award').fill('1,000');
      await page.getByRole('dialog').getByRole('button', { name: 'Record decision' }).click();
      await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
        'Enter an amount between £5,000 and £25,000.',
      );
    },
  },
  {
    name: 'the dialog for changing a decision',
    prepare: mixed,
    open: async (page) => {
      await openList(page);
      await decisionRows(page)
        .first()
        .getByRole('button', { name: /^Change decision/ })
        .click();
      await expect(page.getByRole('dialog', { name: 'Change decision' })).toBeVisible();
    },
  },
  {
    name: 'the dialog for recording decisions for several submissions',
    open: openBulkDialog,
  },
  {
    name: 'the dialog for recording several awards',
    open: async (page) => {
      await openBulkDialog(page);
      await page.getByRole('radio', { name: /^Accepted/ }).check();
      await expect(page.getByRole('group', { name: 'Amount to award to each' })).toBeVisible();
    },
  },
  {
    name: 'the dialog for recording several awards with mistakes in it',
    open: async (page) => {
      await openBulkDialog(page);
      await page.getByRole('radio', { name: /^Accepted/ }).check();
      await page.getByRole('button', { name: 'Record 2 decisions' }).click();
      await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
        'Enter the amount to award, in pounds.',
      );
    },
  },
  {
    name: 'the email for a decision',
    prepare: mixed,
    open: async (page) => {
      await openList(page);
      await decisionRows(page)
        .first()
        .getByRole('button', { name: /^Preview email/ })
        .click();
      await expect(page.getByRole('dialog', { name: /^Email for / })).toContainText(
        'we are offering you a grant',
      );
    },
  },
  {
    name: 'the decisions page after recording a decision',
    open: async (page) => {
      await openRecordDialog(page);
      await page.getByRole('radio', { name: 'Declined' }).check();
      await page.getByRole('dialog').getByRole('button', { name: 'Record decision' }).click();
      await expect(page.getByText(/^Decision recorded for /)).toBeVisible();
    },
  },
  {
    name: 'the decisions page with emails to send',
    prepare: (stub) => {
      decide(stub, 0, 'accepted', { released: true, email: 'pending' });
      decide(stub, 1, 'declined', { released: true });
    },
    open: async (page) => {
      await openList(page);
      await expect(page.getByText('1 decision email not sent')).toBeVisible();
    },
  },
  {
    name: 'the decisions page with no submissions',
    options: { count: 0 },
    open: async (page) => {
      await page.goto(DECISIONS);
      await expect(
        page.getByRole('heading', { level: 2, name: 'No submissions to decide yet' }),
      ).toBeVisible();
    },
  },
  {
    name: 'the decisions page while loading',
    open: async (page) => {
      await neverAnswer(page, `/api/console/rounds/${ids.round}/decisions`);
      await page.goto(DECISIONS);
      await expect(page.getByRole('status').filter({ hasText: 'Loading decisions' })).toBeVisible();
    },
  },
  {
    name: 'the decisions page that could not be loaded',
    open: async (page) => {
      const busy = problem(503, 'The service is busy. Try again in a minute.');
      await page.route(
        (url) => url.pathname === `/api/console/rounds/${ids.round}/decisions`,
        (route) =>
          route.fulfill({
            status: busy.status,
            contentType: 'application/json',
            body: JSON.stringify(busy.body),
          }),
      );
      await page.goto(DECISIONS);
      await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    },
  },
  {
    name: 'the decisions page for someone without the permission',
    options: { permissions: ['grants.applications.read'] },
    open: async (page) => {
      await page.goto(DECISIONS);
      await expect(
        page.getByRole('heading', { level: 2, name: 'You cannot record decisions' }),
      ).toBeVisible();
    },
  },
  {
    name: 'the release page',
    prepare: mixed,
    open: async (page) => {
      await page.goto(RELEASE);
      await expect(page.getByRole('group', { name: 'Decisions to release' })).toBeVisible();
      await expect(
        page.getByText('Community Spaces Fund: we are offering you a grant'),
      ).toBeVisible();
    },
  },
  {
    name: 'the release page with the awards over the budget',
    options: { budget: 20_000 },
    prepare: (stub) => {
      decide(stub, 0, 'accepted', { pounds: 15_000 });
      decide(stub, 1, 'accepted', { pounds: 15_000 });
    },
    open: async (page) => {
      await page.goto(RELEASE);
      await expect(page.getByText(/over budget/)).toBeVisible();
      await expect(
        page.getByText('Community Spaces Fund: we are offering you a grant'),
      ).toBeVisible();
    },
  },
  {
    name: 'the release page when the box has not been ticked',
    prepare: mixed,
    open: async (page) => {
      await page.goto(RELEASE);
      await expect(
        page.getByText('Community Spaces Fund: we are offering you a grant'),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Release decisions' }).click();
      await expect(
        page.getByText('Tick the box to confirm you have checked the summary and the email.'),
      ).toBeVisible();
    },
  },
  {
    name: 'the check that it is you',
    prepare: mixed,
    open: async (page) => {
      await openReleaseWithTheBoxTicked(page);
      await page.getByRole('button', { name: 'Release decisions' }).click();
      await expect(page.getByRole('dialog', { name: 'Confirm it is you' })).toBeVisible();
    },
  },
  {
    name: 'the check that it is you after a wrong password',
    prepare: mixed,
    open: async (page) => {
      await openReleaseWithTheBoxTicked(page);
      await page.getByRole('button', { name: 'Release decisions' }).click();
      const dialog = page.getByRole('dialog', { name: 'Confirm it is you' });
      await dialog.getByLabel('Password').fill('wrong password');
      await dialog.getByLabel('Code from your authenticator app').fill('123456');
      await dialog.getByRole('button', { name: 'Confirm it is you' }).click();
      await expect(dialog.getByRole('alert')).toBeVisible();
    },
  },
  {
    name: 'the release page once the decisions are released',
    prepare: mixed,
    open: async (page) => {
      await openReleaseWithTheBoxTicked(page);
      await page.getByRole('button', { name: 'Release decisions' }).click();
      await confirmItsYou(page, 'correct horse battery', '123456');
      await expect(page.getByText('Decisions released', { exact: true })).toBeVisible();
    },
  },
  {
    name: 'the release page once the decisions are released with emails waiting',
    options: { holdBack: 2 },
    prepare: mixed,
    open: async (page) => {
      await openReleaseWithTheBoxTicked(page);
      await page.getByRole('button', { name: 'Release decisions' }).click();
      await confirmItsYou(page, 'correct horse battery', '123456');
      await expect(page.getByRole('button', { name: 'Send unsent emails' })).toBeVisible();
    },
  },
  {
    name: 'the release page when every decision is released',
    prepare: (stub) => {
      decide(stub, 0, 'accepted', { released: true });
    },
    open: async (page) => {
      await page.goto(RELEASE);
      await expect(
        page.getByRole('heading', { level: 2, name: 'No decisions to release' }),
      ).toBeVisible();
    },
  },
  {
    name: 'the release page while loading',
    open: async (page) => {
      await neverAnswer(page, `/api/console/rounds/${ids.round}/decisions`);
      await page.goto(RELEASE);
      await expect(page.getByRole('status').filter({ hasText: 'Loading decisions' })).toBeVisible();
    },
  },
  {
    name: 'the release page for someone without the permission',
    options: { permissions: ['grants.applications.read', 'grants.decisions.record'] },
    open: async (page) => {
      await page.goto(RELEASE);
      await expect(
        page.getByRole('heading', { level: 2, name: 'You cannot release decisions' }),
      ).toBeVisible();
    },
  },
  {
    name: 'the decision on a submission that has none',
    open: async (page, stub) => {
      await page.goto(`/northfield/submissions/${stub.held[0]?.id ?? ''}`);
      await expect(page.getByRole('region', { name: 'Decision' })).toContainText('No decision yet');
    },
  },
  {
    name: 'the decision on a submission that has one',
    prepare: mixed,
    open: async (page, stub) => {
      await page.goto(`/northfield/submissions/${stub.held[0]?.id ?? ''}`);
      await expect(page.getByRole('region', { name: 'Decision' })).toContainText(
        'Award of £12,500',
      );
    },
  },
  {
    name: 'the dialog for recording a decision from a submission',
    open: async (page, stub) => {
      await page.goto(`/northfield/submissions/${stub.held[0]?.id ?? ''}`);
      await page
        .getByRole('region', { name: 'Decision' })
        .getByRole('button', { name: 'Record decision' })
        .click();
      await expect(page.getByRole('dialog', { name: 'Record decision' })).toBeVisible();
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
        const stub = await stubDecisions(page, state.options);
        await state.prepare?.(stub, page);
        await state.open(page, stub);
        // A dialog hides the page behind it from the accessibility tree, but the page still has its one heading.
        await expect(page.locator('h1')).toHaveCount(1);

        await expectNoViolations(page);
        await expectNoHorizontalScroll(page);
      });
    }
  });
}
