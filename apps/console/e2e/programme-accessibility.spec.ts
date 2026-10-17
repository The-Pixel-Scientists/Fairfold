// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Axe checks for every programme set-up screen and state, at desktop width,
// at 320 px wide and at 200% zoom (ADR 0006), and at desktop width in the
// dark scheme, with the API's answers stubbed (programme-api.ts). In
// console-production they run under the production content security policy.

import { expect as strictExpect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { problem } from './auth-api.ts';
import { expectNoHorizontalScroll, expectNoViolations, variants } from './auth-axe.ts';
import { configured, ids, stubProgrammes } from './programme-api.ts';
import type { ProgrammeStub, SetUp } from './programme-api.ts';
import { enterMoment } from './programme-steps.ts';

/** Each page loads its code when it is first opened, which a busy machine or a development server's first compile can slow past five seconds. */
const expect = strictExpect.configure({ timeout: 15_000 });

const summary = (page: Page) => page.getByRole('alert', { name: 'There is a problem' });
const busy = problem(503, 'The service is busy. Try again in a minute.');

/** A request that is never answered, so the page stays on its loading state. */
async function neverAnswer(page: Page, path: string): Promise<void> {
  await page.route(
    (url) => url.pathname === path,
    () => undefined,
  );
}

/** A programme that has no round yet. */
function withoutRound(): SetUp {
  return { ...configured(), round: null, stages: [], roundVersions: [] };
}

/** A programme with more changes in its history than the panel shows at first. */
function withLongHistory(): SetUp {
  const setUp = configured();
  const [latest] = setUp.programmeVersions;
  if (latest) {
    for (let version = 2; version <= 7; version += 1) {
      setUp.programmeVersions.unshift({
        ...latest,
        version,
        createdAt: `2026-10-1${String(version)}T10:00:00.000Z`,
      });
    }
  }
  return setUp;
}

interface State {
  name: string;
  /** Sets the API's answers for this state. */
  stub?: (page: Page) => Promise<ProgrammeStub>;
  /** Opens the screen and gets it into the state, and waits until it is showing. */
  open: (page: Page) => Promise<void>;
}

const states: State[] = [
  {
    name: 'the programmes list',
    stub: (page) => stubProgrammes(page, configured()),
    open: async (page) => {
      await page.goto('/northfield/');
      await expect(page.getByRole('table', { name: 'Programmes' })).toBeVisible();
    },
  },
  {
    name: 'the programmes list with no programmes',
    open: async (page) => {
      await page.goto('/northfield/');
      await expect(
        page.getByRole('heading', { level: 2, name: 'No programmes yet' }),
      ).toBeVisible();
    },
  },
  {
    name: 'the programmes list while loading',
    open: async (page) => {
      await neverAnswer(page, '/api/console/programmes');
      await page.goto('/northfield/');
      await expect(
        page.getByRole('status').filter({ hasText: 'Loading programmes' }),
      ).toBeVisible();
    },
  },
  {
    name: 'the programmes list that could not be loaded',
    stub: (page) => stubProgrammes(page, configured(), { 'GET /console/programmes': busy }),
    open: async (page) => {
      await page.goto('/northfield/');
      await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    },
  },
  {
    name: 'the programmes list for someone without the permission',
    stub: (page) => stubProgrammes(page, configured(), {}, ['grants.reviews.score']),
    open: async (page) => {
      await page.goto('/northfield/');
      await expect(
        page.getByRole('heading', { level: 2, name: 'You cannot set up programmes' }),
      ).toBeVisible();
    },
  },
  {
    name: 'the new programme form',
    open: async (page) => {
      await page.goto('/northfield/programmes/new');
      await expect(page.getByRole('textbox', { name: 'Title' })).toBeVisible();
    },
  },
  {
    name: 'the new programme form with problems',
    open: async (page) => {
      await page.goto('/northfield/programmes/new');
      await page.getByRole('button', { name: 'Create programme' }).click();
      await expect(summary(page)).toBeFocused();
    },
  },
  {
    name: 'the edit programme form after saving',
    stub: (page) => stubProgrammes(page, configured()),
    open: async (page) => {
      await page.goto(`/northfield/programmes/${ids.programme}/edit`);
      await page.getByRole('textbox', { name: 'Summary' }).fill('Grants for community buildings.');
      await page.getByRole('button', { name: 'Save programme' }).click();
      await expect(page.getByText('Programme saved.')).toBeVisible();
    },
  },
  {
    name: 'the dialog before leaving with changes that are not saved',
    stub: (page) => stubProgrammes(page, configured()),
    open: async (page) => {
      await page.goto(`/northfield/programmes/${ids.programme}/edit`);
      await page.getByRole('textbox', { name: 'Title' }).fill('Community Places Fund');
      await page.getByRole('link', { name: 'Back to programme' }).click();
      await expect(page.getByRole('dialog', { name: 'Leave this page?' })).toBeVisible();
    },
  },
  {
    name: 'a programme',
    stub: (page) => stubProgrammes(page, configured()),
    open: async (page) => {
      await page.goto(`/northfield/programmes/${ids.programme}`);
      await expect(page.getByRole('table', { name: 'Rounds' })).toBeVisible();
      await expect(page.getByRole('table', { name: 'Outcome emails' })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Configuration history' })).toContainText(
        'Created',
      );
    },
  },
  {
    name: 'a programme with no rounds',
    stub: (page) => stubProgrammes(page, withoutRound()),
    open: async (page) => {
      await page.goto(`/northfield/programmes/${ids.programme}`);
      await expect(page.getByRole('heading', { level: 3, name: 'No rounds yet' })).toBeVisible();
    },
  },
  {
    name: 'a programme with a long history, all of it shown',
    stub: (page) => stubProgrammes(page, withLongHistory()),
    open: async (page) => {
      await page.goto(`/northfield/programmes/${ids.programme}`);
      await page.getByRole('button', { name: /^Show \d+ older changes$/ }).click();
      await expect(page.getByRole('button', { name: 'Show recent changes only' })).toBeVisible();
    },
  },
  {
    name: 'a programme that could not be loaded',
    stub: (page) =>
      stubProgrammes(page, configured(), { [`GET /console/programmes/${ids.programme}`]: busy }),
    open: async (page) => {
      await page.goto(`/northfield/programmes/${ids.programme}`);
      await expect(page.getByRole('button', { name: 'Try again' }).first()).toBeVisible();
    },
  },
  {
    name: 'the new round form',
    stub: (page) => stubProgrammes(page, configured()),
    open: async (page) => {
      await page.goto(`/northfield/programmes/${ids.programme}/rounds/new`);
      await expect(page.getByRole('textbox', { name: 'Budget' })).toBeVisible();
    },
  },
  {
    name: 'the new round form with problems',
    stub: (page) => stubProgrammes(page, configured()),
    open: async (page) => {
      await page.goto(`/northfield/programmes/${ids.programme}/rounds/new`);
      await page.getByRole('button', { name: 'Add round' }).click();
      await expect(summary(page)).toBeFocused();
    },
  },
  {
    name: 'the new round form with a closing time before the opening time',
    stub: (page) => stubProgrammes(page, configured()),
    open: async (page) => {
      await page.goto(`/northfield/programmes/${ids.programme}/rounds/new`);
      await page.getByRole('textbox', { name: 'Title' }).fill('Spring 2027');
      await enterMoment(page, 'Opening', ['2', '11', '2026'], '09:00');
      await enterMoment(page, 'Closing', ['12', '10', '2026'], '17:00');
      await page.getByRole('textbox', { name: 'Budget' }).fill('150000');
      await page.getByRole('textbox', { name: 'Smallest award' }).fill('5000');
      await page.getByRole('textbox', { name: 'Largest award' }).fill('25000');
      await page.getByRole('button', { name: 'Add round' }).click();
      await expect(summary(page)).toBeFocused();
    },
  },
  {
    name: 'a round',
    stub: (page) => stubProgrammes(page, configured()),
    open: async (page) => {
      await page.goto(`/northfield/rounds/${ids.round}`);
      await expect(page.getByRole('tabpanel')).toContainText('£150,000');
    },
  },
  {
    name: 'the stages and rubrics of a round',
    stub: (page) => stubProgrammes(page, configured()),
    open: async (page) => {
      await page.goto(`/northfield/rounds/${ids.round}`);
      await page.getByRole('tab', { name: 'Stages and rubrics' }).click();
      await expect(page.getByRole('table', { name: 'Stages in this round' })).toBeVisible();
    },
  },
  {
    name: 'the history of a round, with a change opened',
    stub: (page) => stubProgrammes(page, configured()),
    open: async (page) => {
      await page.goto(`/northfield/rounds/${ids.round}`);
      await page.getByRole('tab', { name: 'History' }).click();
      await page.getByText('See what changed').first().click();
      await expect(page.getByText('Before: Not set').first()).toBeVisible();
    },
  },
  {
    name: 'the edit round form',
    stub: (page) => stubProgrammes(page, configured()),
    open: async (page) => {
      await page.goto(`/northfield/rounds/${ids.round}/edit`);
      await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('Autumn 2026');
    },
  },
  {
    name: 'the stages of a round',
    stub: (page) => stubProgrammes(page, configured()),
    open: async (page) => {
      await page.goto(`/northfield/rounds/${ids.round}/stages`);
      await expect(page.getByRole('textbox', { name: /^Stage name/ })).toHaveCount(3);
    },
  },
  {
    name: 'the stages of a round with a stage that has no name',
    stub: (page) => stubProgrammes(page, configured()),
    open: async (page) => {
      await page.goto(`/northfield/rounds/${ids.round}/stages`);
      await page.getByRole('textbox', { name: /^Stage name\s*3$/ }).fill('');
      await page.getByRole('button', { name: 'Save stages' }).click();
      await expect(summary(page)).toBeFocused();
    },
  },
  {
    name: 'the rubric of a stage',
    stub: (page) => stubProgrammes(page, configured()),
    open: async (page) => {
      await page.goto(`/northfield/rounds/${ids.round}/stages/${ids.review}/rubric`);
      await expect(page.getByRole('textbox', { name: /^Criterion\s*3$/ })).toBeVisible();
      await expect(page.getByRole('meter')).toHaveCount(3);
    },
  },
  {
    name: 'a stage with no rubric',
    stub: (page) => stubProgrammes(page, configured()),
    open: async (page) => {
      await page.goto(`/northfield/rounds/${ids.round}/stages/${ids.intake}/rubric`);
      await expect(
        page.getByRole('heading', { level: 3, name: 'No rubric for this stage' }),
      ).toBeVisible();
    },
  },
  {
    name: 'the rubric of a stage with problems',
    stub: (page) => stubProgrammes(page, configured()),
    open: async (page) => {
      await page.goto(`/northfield/rounds/${ids.round}/stages/${ids.review}/rubric`);
      await page
        .getByRole('textbox', { name: /^Weight/ })
        .first()
        .fill('');
      await page
        .getByRole('textbox', { name: /^Highest score/ })
        .nth(1)
        .fill('1');
      await page.getByRole('button', { name: 'Save rubric' }).click();
      await expect(summary(page)).toBeFocused();
    },
  },
  {
    name: 'a stage that is not in the round',
    stub: (page) => stubProgrammes(page, configured()),
    open: async (page) => {
      await page.goto(`/northfield/rounds/${ids.round}/stages/${ids.more[5]}/rubric`);
      await expect(
        page.getByRole('heading', { level: 2, name: 'We cannot find this stage' }),
      ).toBeVisible();
    },
  },
  {
    name: 'the outcome emails',
    stub: (page) => stubProgrammes(page, configured()),
    open: async (page) => {
      await page.goto(`/northfield/programmes/${ids.programme}/emails`);
      await expect(page.getByRole('region', { name: 'Declined email' })).toBeVisible();
    },
  },
  {
    name: 'the outcome emails with a merge field that is not allowed',
    stub: (page) => stubProgrammes(page, configured()),
    open: async (page) => {
      await page.goto(`/northfield/programmes/${ids.programme}/emails`);
      await page
        .getByRole('region', { name: 'Declined email' })
        .getByRole('textbox', { name: 'Text of the email' })
        .fill('Dear {{given_name}}, you are awarded {{award_amount}}.');
      await page.getByRole('button', { name: 'Save emails' }).click();
      await expect(summary(page)).toBeFocused();
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
        await (state.stub ?? ((target) => stubProgrammes(target)))(page);
        await state.open(page);
        // A dialog hides the page behind it from the accessibility tree, but the page still has its one heading.
        await expect(page.locator('h1')).toHaveCount(1);

        await expectNoViolations(page);
        await expectNoHorizontalScroll(page);
      });
    }
  });
}
