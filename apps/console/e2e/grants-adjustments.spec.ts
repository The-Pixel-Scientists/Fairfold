// SPDX-License-Identifier: AGPL-3.0-or-later
//
// More time, the alternative route, submitting for an applicant and the
// round's equality monitoring form in a real browser, with the API's answers
// stubbed (grants-adjustments-api.ts). Every spec also fails on a Content
// Security Policy violation, so the screens are checked under the production
// policy in console-production. The axe specs check each screen and dialog at
// desktop width, 320 px, 200% zoom and in the dark scheme.

import { expect as strictExpect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { expectNoHorizontalScroll, expectNoViolations, variants } from './auth-axe.ts';
import {
  grantAdjustmentFor,
  monitoringDraftId,
  monitoringVersionId,
  stubGrants,
  submission,
} from './grants-adjustments-api.ts';
import { ids } from './programme-api.ts';

/** Each page loads its code when it is first opened, which a busy machine or a development server's first compile can slow past five seconds. */
const expect = strictExpect.configure({ timeout: 15_000 });

const SUBMISSION = `/northfield/submissions/${submission.id}`;
const ROUND = `/northfield/rounds/${ids.round}`;
const NAME = submission.organisation.name;

async function enterClosing(
  page: Page,
  [day, month, year]: [string, string, string],
  time: string,
) {
  const date = page.getByRole('group', { name: /New closing date/ });
  await date.getByRole('textbox', { name: 'Day' }).fill(day);
  await date.getByRole('textbox', { name: 'Month' }).fill(month);
  await date.getByRole('textbox', { name: 'Year' }).fill(year);
  await page.getByLabel('New closing time').fill(time);
}

async function stepUp(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Confirm it is you' });
  await dialog.getByLabel('Password').fill('correct horse battery');
  await dialog.getByLabel(/Code from your authenticator app/).fill('123456');
  await dialog.getByRole('button', { name: 'Confirm it is you' }).click();
}

async function answerEverything(page: Page) {
  await page.getByRole('radio', { name: 'Yes' }).check();
  await page
    .getByRole('textbox', { name: 'What will you do with the money?' })
    .fill('Run a weekly lunch.');
}

const adjustments = (page: Page) => page.getByRole('region', { name: 'More time and adjustments' });

test.describe('more time for an application', () => {
  test('gives more time with a reason code, shows it, and keeps the reason out of the address and title', async ({
    page,
  }) => {
    const grants = await stubGrants(page, { adjustments: [] });
    await page.goto(SUBMISSION);
    await expect(adjustments(page).getByText('No adjustments.')).toBeVisible();

    await adjustments(page).getByRole('button', { name: 'Give more time' }).click();
    const dialog = page.getByRole('dialog', { name: 'Give more time' });
    await expect(dialog.getByText('UK time', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Give more time' }).click();
    await expect(dialog.getByText('Choose a reason for the adjustment.')).toBeVisible();

    await enterClosing(page, ['9', '11', '2026'], '17:01');
    await dialog.getByLabel('Reason').selectOption({ label: 'Caring responsibilities' });
    await dialog.getByRole('button', { name: 'Give more time' }).click();

    await expect(dialog).toBeHidden();
    await expect(adjustments(page)).toContainText(
      'More time to apply until 9 November 2026 at 5:01pm, UK time',
    );
    await expect(adjustments(page)).toContainText('Closes 9 November 2026 at 5:01pm, UK time.');
    expect(page.url()).not.toMatch(/caring|reason/i);
    expect(await page.title()).not.toMatch(/caring|reason/i);
    expect(grants.adjustments).toHaveLength(1);
  });

  test('asks before removing an adjustment and shows it removed', async ({ page }) => {
    const grants = await stubGrants(page, { adjustments: [grantAdjustmentFor(1)] });
    await page.goto(SUBMISSION);

    await adjustments(page)
      .getByRole('button', { name: /^Remove/ })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Remove this adjustment?' });
    await dialog
      .getByLabel('Why are you removing it?')
      .selectOption({ label: 'The applicant asked' });
    await dialog.getByRole('button', { name: 'Remove adjustment' }).click();

    await expect(adjustments(page).getByText('Removed', { exact: true })).toBeVisible();
    // The Remove button that opened the dialog is gone: focus goes to the notice, not the top of the page.
    await expect(
      adjustments(page).getByRole('status').filter({ hasText: 'Adjustment removed for' }),
    ).toBeFocused();
    expect(grants.adjustments[0]?.['revoked']).not.toBeNull();
  });
});

test.describe('submitting for an applicant', () => {
  test('starts, fills in, checks and submits an application with step-up, and shows it was submitted by staff', async ({
    page,
  }) => {
    await stubGrants(page, {
      adjustments: [grantAdjustmentFor(2, { kind: 'alternative_route', closesAt: null })],
    });
    await page.goto(ROUND);
    await page.getByRole('tab', { name: 'More time and adjustments' }).click();
    await page.getByRole('button', { name: /^Start application/ }).click();
    const start = page.getByRole('dialog', { name: 'Start an application for an applicant' });
    await start.getByLabel('Who is applying?').selectOption({ label: 'Sam Patel' });
    await start.getByRole('button', { name: `Start application for ${NAME}` }).click();
    await stepUp(page);

    const banner = page
      .getByRole('status')
      .filter({ hasText: 'You are filling in this application for' });
    await expect(banner).toContainText(
      `${NAME} on behalf of Sam Patel. They will be told you submitted it.`,
    );
    await answerEverything(page);
    await page.getByRole('button', { name: 'Save and check answers' }).click();

    await expect(
      page.getByRole('heading', { level: 2, name: 'Check before you submit' }),
    ).toBeFocused();
    await expect(banner).toBeVisible();
    await page.getByRole('button', { name: `Submit application for ${NAME}` }).click();
    await stepUp(page);

    await expect(page).toHaveURL(SUBMISSION);
    await expect(page.getByText('Submitted by staff: Ada Reed')).toBeVisible();
  });
});

test.describe('the banner and focus in an application for an applicant', () => {
  const DRAFT = `/northfield/assisted-applications/${submission.id}`;

  test('goes back to the answers with focus on the first section', async ({ page }) => {
    await stubGrants(page);
    await page.goto(DRAFT);
    await answerEverything(page);
    await page.getByRole('button', { name: 'Save and check answers' }).click();
    await page.getByRole('button', { name: 'Back to answers' }).click();

    await expect(
      page.getByRole('heading', { level: 2, name: 'About your organisation' }),
    ).toBeFocused();
  });

  test.describe('at 320 px', () => {
    test.use({ viewport: { width: 320, height: 640 } });

    test('keeps the banner in the page, so it never covers the control that has focus', async ({
      page,
    }) => {
      await stubGrants(page);
      await page.goto(DRAFT);
      const banner = page.getByRole('status').filter({ hasText: 'You are filling in' });
      await expect(banner).toBeVisible();
      await expect(banner.locator('xpath=..')).toHaveCSS('position', 'static');

      await page.getByRole('button', { name: 'Save and check answers' }).focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Shift+Tab');
      // Whatever is drawn at the middle of the focused control is the control itself.
      const reachable = await page.locator(':focus').evaluate((element) => {
        const box = element.getBoundingClientRect();
        const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return top === element || element.contains(top);
      });
      expect(reachable).toBe(true);
    });
  });
});

test.describe('equality monitoring set-up', () => {
  test('chooses a monitoring form for the round and says staff only ever see totals', async ({
    page,
  }) => {
    const grants = await stubGrants(page);
    await page.goto(ROUND);
    await page.getByRole('tab', { name: 'Equality monitoring' }).click();

    await expect(
      page.getByText('Staff and reviewers never see individual answers. Reports show only totals.'),
    ).toBeVisible();
    await page.getByLabel('Equality monitoring form').selectOption({ value: monitoringVersionId });
    await page.getByRole('button', { name: 'Save equality monitoring form' }).click();

    await expect(page.getByText('Equality monitoring form saved.')).toBeVisible();
    expect(grants.monitoringFormVersionId).toBe(monitoringVersionId);
  });
});

test.describe('the equality monitoring form builder', () => {
  test('publishes a monitoring form from the template, with every question only in totals', async ({
    page,
  }) => {
    const grants = await stubGrants(page);
    await page.goto(`${ROUND}/form`);
    await page.getByRole('button', { name: 'Create equality monitoring draft' }).click();

    await expect(
      page.getByRole('heading', { level: 1, name: 'Equality monitoring form' }),
    ).toBeVisible();
    await expect(page.getByText(/seen only in totals/).first()).toBeVisible();
    await page.getByRole('checkbox', { name: 'What is your religion or belief?' }).uncheck();
    await page.getByRole('button', { name: 'Publish version 3' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Publish version 3' }).click();

    await expect(page.getByText('Version 3 is published.')).toBeVisible();
    const saved = grants.monitoringDraft?.definition as {
      sections: { fields: { id: string; audiences: string }[] }[];
    };
    expect(saved.sections[0]?.fields.map((field) => field.id)).not.toContain('f_religion');
    expect(saved.sections[0]?.fields.every((field) => field.audiences === 'aggregate_only')).toBe(
      true,
    );
  });
});

interface State {
  name: string;
  open: (page: Page) => Promise<void>;
}

const states: State[] = [
  {
    name: 'a submission with its adjustments',
    open: async (page) => {
      await page.goto(SUBMISSION);
      await expect(adjustments(page).getByText(/^Closes /)).toBeVisible();
    },
  },
  {
    name: 'the give more time dialog with its refusals',
    open: async (page) => {
      await page.goto(SUBMISSION);
      await adjustments(page).getByRole('button', { name: 'Give more time' }).click();
      await page
        .getByRole('dialog', { name: 'Give more time' })
        .getByRole('button', { name: 'Give more time' })
        .click();
      await expect(page.getByText('Choose a reason for the adjustment.')).toBeVisible();
    },
  },
  {
    name: 'the alternative route dialog',
    open: async (page) => {
      await page.goto(SUBMISSION);
      await adjustments(page).getByRole('button', { name: 'Let staff submit for them' }).click();
      await expect(
        page.getByRole('dialog', { name: 'Let staff submit for the applicant' }),
      ).toBeVisible();
    },
  },
  {
    name: 'the remove adjustment dialog',
    open: async (page) => {
      await page.goto(SUBMISSION);
      await adjustments(page)
        .getByRole('button', { name: /^Remove/ })
        .first()
        .click();
      await expect(page.getByRole('dialog', { name: 'Remove this adjustment?' })).toBeVisible();
    },
  },
  {
    name: "a round's adjustments",
    open: async (page) => {
      await page.goto(ROUND);
      await page.getByRole('tab', { name: 'More time and adjustments' }).click();
      await expect(page.getByRole('table', { name: 'Adjustments in this round' })).toBeVisible();
      await expect(
        page.getByRole('heading', { name: 'Applications staff are filling in' }),
      ).toBeVisible();
    },
  },
  {
    name: 'the dialog for choosing an organisation',
    open: async (page) => {
      await page.goto(ROUND);
      await page.getByRole('tab', { name: 'More time and adjustments' }).click();
      await page.getByRole('button', { name: 'Let staff submit for an organisation' }).click();
      await page.getByLabel('Organisation name or number').fill('Harbourside');
      await page.getByRole('button', { name: 'Search organisations' }).click();
      await expect(page.getByRole('button', { name: NAME })).toBeVisible();
    },
  },
  {
    name: 'the dialog for starting an application for an applicant',
    open: async (page) => {
      await page.goto(ROUND);
      await page.getByRole('tab', { name: 'More time and adjustments' }).click();
      await page.getByRole('button', { name: /^Start application/ }).click();
      await expect(page.getByLabel('Who is applying?')).toBeVisible();
    },
  },
  {
    name: 'the answers of an application for an applicant',
    open: async (page) => {
      await page.goto(`/northfield/assisted-applications/${submission.id}`);
      await expect(
        page.getByRole('heading', { level: 1, name: `Application for ${NAME}` }),
      ).toBeVisible();
      await expect(
        page.getByRole('status').filter({ hasText: 'You are filling in' }),
      ).toBeVisible();
    },
  },
  {
    name: 'a submission with an adjustment removed',
    open: async (page) => {
      await page.goto(SUBMISSION);
      await adjustments(page)
        .getByRole('button', { name: /^Remove/ })
        .first()
        .click();
      const dialog = page.getByRole('dialog', { name: 'Remove this adjustment?' });
      await dialog
        .getByLabel('Why are you removing it?')
        .selectOption({ label: 'The applicant asked' });
      await dialog.getByRole('button', { name: 'Remove adjustment' }).click();
      await expect(adjustments(page).getByText('Removed', { exact: true })).toBeVisible();
    },
  },
  {
    name: 'the check of an application for an applicant, with every question answered',
    open: async (page) => {
      await page.goto(`/northfield/assisted-applications/${submission.id}`);
      await answerEverything(page);
      await page.getByRole('button', { name: 'Save and check answers' }).click();
      await expect(page.getByText('Every question that needs an answer has one.')).toBeVisible();
    },
  },
  {
    name: 'the check of an application for an applicant, with questions left',
    open: async (page) => {
      await page.goto(`/northfield/assisted-applications/${submission.id}`);
      await page.getByRole('button', { name: 'Save and check answers' }).click();
      await expect(page.getByRole('heading', { level: 3, name: 'Still to answer' })).toBeVisible();
    },
  },
  {
    name: 'the equality monitoring form builder',
    open: async (page) => {
      await page.goto(`${ROUND}/form/${monitoringDraftId}?template=monitoring`);
      await expect(page.getByRole('list', { name: 'Questions' })).toBeVisible();
    },
  },
  {
    name: "a round's equality monitoring form",
    open: async (page) => {
      await page.goto(ROUND);
      await page.getByRole('tab', { name: 'Equality monitoring' }).click();
      await expect(page.getByLabel('Equality monitoring form')).toBeVisible();
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
        await stubGrants(page);
        await state.open(page);
        await expect(page.locator('h1')).toHaveCount(1);

        await expectNoViolations(page);
        await expectNoHorizontalScroll(page);
      });
    }
  });
}
