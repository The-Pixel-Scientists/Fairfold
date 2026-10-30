// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Axe checks for every assessment screen and state, at desktop width, at
// 320 px wide and at 200% zoom (ADR 0006), and at desktop width in the dark
// scheme, with the API's answers stubbed (assessment-api.ts). In
// console-production they run under the production content security policy.

import { expect as strictExpect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { stubAssessment, ids } from './assessment-api.ts';
import type { AssessmentOptions, AssessmentStub } from './assessment-api.ts';
import {
  openSubmissionsInReview,
  reviewRows,
  spreadRows,
  scoreFromTheKeyboard,
} from './assessment-steps.ts';
import { problem } from './auth-api.ts';
import { expectNoHorizontalScroll, expectNoViolations, variants } from './auth-axe.ts';
import { submissionRows } from './submissions-steps.ts';

/** Each page loads its code when it is first opened, which a busy machine or a development server's first compile can slow past five seconds. */
const expect = strictExpect.configure({ timeout: 15_000 });

const busy = problem(503, 'The service is busy. Try again in a minute.');

/** A request that is never answered, so the page stays on its loading state. */
async function neverAnswer(page: Page, pattern: RegExp): Promise<void> {
  await page.route(
    (url) => pattern.test(url.pathname),
    () => undefined,
  );
}

async function failWith(page: Page, pattern: RegExp): Promise<void> {
  await page.route(
    (url) => pattern.test(url.pathname),
    (route) =>
      route.fulfill({
        status: busy.status,
        contentType: 'application/json',
        body: JSON.stringify(busy.body),
      }),
  );
}

const REVIEWERS = `/northfield/rounds/${ids.round}/reviewers`;
const SPREAD = `/northfield/rounds/${ids.round}/score-spread`;

interface State {
  name: string;
  options?: AssessmentOptions;
  /** Changes what the stand-in holds, before the page opens. */
  prepare?: (stub: AssessmentStub) => void;
  /** Sets up routes of its own, before the page opens. */
  setUp?: (page: Page) => Promise<void>;
  /** Opens the screen and gets it into the state, and waits until it is showing. */
  open: (page: Page, stub: AssessmentStub) => Promise<void>;
}

const manager: AssessmentOptions = { as: 'manager' };
const reviewer: AssessmentOptions = { as: 'reviewer' };

const inReview = (page: Page) => openSubmissionsInReview(page, ids.round, ids.review);

async function choose(page: Page, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await submissionRows(page).nth(index).getByRole('checkbox').check();
  }
}

const states: State[] = [
  {
    name: 'the reviewers of a round',
    options: manager,
    open: async (page) => {
      await page.goto(REVIEWERS);
      await expect(page.getByRole('table', { name: 'Reviewers in the pool' })).toBeVisible();
    },
  },
  {
    name: 'the reviewers of a round with a member chosen to add',
    options: manager,
    open: async (page) => {
      await page.goto(REVIEWERS);
      await page.getByRole('checkbox', { name: 'Hannah Lewis' }).check();
      await expect(page.getByRole('button', { name: 'Add 1 reviewer' })).toBeVisible();
    },
  },
  {
    name: 'the dialog for removing a reviewer from the pool',
    options: manager,
    open: async (page) => {
      await page.goto(REVIEWERS);
      await page.getByRole('button', { name: /Remove.*Tom Okafor/ }).click();
      await expect(
        page.getByRole('dialog', { name: 'Remove Tom Okafor from the pool?' }),
      ).toBeVisible();
    },
  },
  {
    name: 'the reviewers of a round after one was added',
    options: manager,
    open: async (page) => {
      await page.goto(REVIEWERS);
      await page.getByRole('checkbox', { name: 'Hannah Lewis' }).check();
      await page.getByRole('button', { name: 'Add 1 reviewer' }).click();
      await expect(page.getByText('1 reviewer added to the pool.')).toBeVisible();
    },
  },
  {
    name: 'the reviewers of a round with an empty pool and no one to add',
    options: manager,
    prepare: (stub) => {
      stub.pool.splice(0);
      stub.candidates.splice(0);
    },
    open: async (page) => {
      await page.goto(REVIEWERS);
      await expect(
        page.getByRole('heading', { level: 3, name: 'No reviewers in this round yet' }),
      ).toBeVisible();
    },
  },
  {
    name: 'the reviewers of a round while loading',
    options: manager,
    setUp: (page) => neverAnswer(page, /\/api\/console\/rounds\/[^/]+\/reviewers$/),
    open: async (page) => {
      await page.goto(REVIEWERS);
      await expect(page.getByRole('status').filter({ hasText: 'Loading reviewers' })).toBeVisible();
    },
  },
  {
    name: 'the reviewers of a round that could not be loaded',
    options: manager,
    setUp: (page) => failWith(page, /\/api\/console\/rounds\/[^/]+\/reviewers$/),
    open: async (page) => {
      await page.goto(REVIEWERS);
      await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    },
  },
  {
    name: 'the reviewers of a round for someone who cannot assign reviewers',
    options: reviewer,
    open: async (page) => {
      await page.goto(REVIEWERS);
      await expect(
        page.getByRole('heading', { level: 2, name: 'You cannot manage reviewers' }),
      ).toBeVisible();
    },
  },
  {
    name: 'the list of submissions with reviewers to assign',
    options: manager,
    open: async (page) => {
      await inReview(page);
      await choose(page, 2);
      await expect(page.getByRole('button', { name: 'Assign reviewers' })).toBeEnabled();
    },
  },
  {
    name: 'the dialog for assigning reviewers',
    options: manager,
    open: async (page) => {
      await inReview(page);
      await choose(page, 2);
      await page.getByRole('button', { name: 'Assign reviewers' }).click();
      const dialog = page.getByRole('dialog', { name: 'Assign reviewers' });
      await expect(dialog.getByRole('checkbox', { name: /Tom Okafor/ })).toBeVisible();
    },
  },
  {
    name: 'the dialog for assigning reviewers when the pool is empty',
    options: manager,
    prepare: (stub) => {
      stub.pool.splice(0);
    },
    open: async (page) => {
      await inReview(page);
      await choose(page, 1);
      await page.getByRole('button', { name: 'Assign reviewers' }).click();
      await expect(page.getByRole('link', { name: 'Set up reviewers' })).toBeVisible();
    },
  },
  {
    name: 'the dialog for assigning reviewers to submissions in different stages',
    options: manager,
    open: async (page) => {
      await page.goto('/northfield/submissions');
      await expect(submissionRows(page)).toHaveCount(50);
      // The first six are in Review and the rest in Intake.
      await submissionRows(page).nth(0).getByRole('checkbox').check();
      await submissionRows(page).nth(10).getByRole('checkbox').check();
      await page.getByRole('button', { name: 'Assign reviewers' }).click();
      await expect(page.getByText(/not all in the same one/)).toBeVisible();
    },
  },
  {
    name: 'the dialog for assigning automatically',
    options: manager,
    open: async (page) => {
      await inReview(page);
      await choose(page, 3);
      await page.getByRole('button', { name: 'Assign automatically' }).click();
      await expect(
        page.getByRole('combobox', { name: 'Reviewers for each submission' }),
      ).toBeVisible();
    },
  },
  {
    name: 'the dialog for assigning automatically after it left a submission short',
    options: manager,
    open: async (page) => {
      await inReview(page);
      await choose(page, 1);
      await page.getByRole('button', { name: 'Assign automatically' }).click();
      const dialog = page.getByRole('dialog', { name: 'Assign automatically' });
      await dialog.getByRole('combobox').selectOption('5');
      await dialog.getByRole('button', { name: 'Assign 5 reviewers to each' }).click();
      await expect(dialog.getByRole('status')).toContainText('could not get all the reviewers');
    },
  },
  {
    name: 'a submission with its reviewers',
    options: manager,
    open: async (page, stub) => {
      await page.goto(`/northfield/submissions/${stub.held[0]?.id ?? ''}`);
      const panel = page.getByRole('region', { name: 'Reviewers' });
      await expect(panel.getByRole('listitem')).toHaveCount(2);
    },
  },
  {
    name: 'a submission with no reviewers',
    options: manager,
    open: async (page, stub) => {
      await page.goto(`/northfield/submissions/${stub.held[5]?.id ?? ''}`);
      await expect(page.getByText('No reviewers are assigned yet')).toBeVisible();
    },
  },
  {
    name: 'the dialog for assigning reviewers to one submission',
    options: manager,
    open: async (page, stub) => {
      await page.goto(`/northfield/submissions/${stub.held[5]?.id ?? ''}`);
      await page.getByRole('button', { name: 'Assign reviewers' }).click();
      await expect(
        page.getByRole('dialog', { name: 'Assign reviewers' }).getByRole('checkbox').first(),
      ).toBeVisible();
    },
  },
  {
    name: 'the dialog for removing a reviewer from a submission',
    options: manager,
    open: async (page, stub) => {
      await page.goto(`/northfield/submissions/${stub.held[5]?.id ?? ''}`);
      await page.getByRole('button', { name: 'Assign reviewers' }).click();
      await page.getByRole('checkbox', { name: /Tom Okafor/ }).check();
      await page.getByRole('button', { name: 'Assign 1 reviewer' }).click();
      await page.getByRole('button', { name: /Remove.*Tom Okafor/ }).click();
      await expect(
        page.getByRole('dialog', { name: 'Remove Tom Okafor from this submission?' }),
      ).toBeVisible();
    },
  },
  {
    name: 'the score spread',
    options: manager,
    open: async (page) => {
      await page.goto(SPREAD);
      await expect(spreadRows(page)).toHaveCount(1);
    },
  },
  {
    name: 'the score spread filtered to wide spreads with none',
    options: manager,
    prepare: (stub) => {
      // Make the two reviewers agree.
      for (const item of stub.assignments)
        item.scores = item.scores.map((score) => ({ ...score, score: 4 }));
    },
    open: async (page) => {
      await page.goto(SPREAD);
      await page.getByRole('button', { name: /^Wide spread/ }).click();
      await expect(page.getByRole('heading', { level: 2, name: 'No wide spreads' })).toBeVisible();
    },
  },
  {
    name: 'the scores of one submission',
    options: manager,
    open: async (page) => {
      await page.goto(SPREAD);
      await spreadRows(page)
        .first()
        .getByRole('button', { name: /Show scores/ })
        .click();
      await expect(page.getByRole('dialog').getByRole('table')).toBeVisible();
    },
  },
  {
    name: 'the keyboard shortcuts of the score spread',
    options: manager,
    open: async (page) => {
      await page.goto(SPREAD);
      await spreadRows(page).first().focus();
      await page.keyboard.press('?');
      await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
    },
  },
  {
    name: 'the score spread with no reviewers assigned',
    options: manager,
    prepare: (stub) => {
      stub.assignments.splice(0);
    },
    open: async (page) => {
      await page.goto(SPREAD);
      await expect(
        page.getByRole('heading', { level: 2, name: 'No reviewers are assigned yet' }),
      ).toBeVisible();
    },
  },
  {
    name: 'the score spread while loading',
    options: manager,
    setUp: (page) => neverAnswer(page, /\/api\/console\/rounds\/[^/]+\/score-spread$/),
    open: async (page) => {
      await page.goto(SPREAD);
      await expect(page.getByRole('status').filter({ hasText: 'Loading scores' })).toBeVisible();
    },
  },
  {
    name: 'the score spread that could not be loaded',
    options: manager,
    setUp: (page) => failWith(page, /\/api\/console\/rounds\/[^/]+\/score-spread$/),
    open: async (page) => {
      await page.goto(SPREAD);
      await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    },
  },
  {
    name: 'My reviews',
    options: reviewer,
    open: async (page) => {
      await page.goto('/northfield/reviews');
      await expect(reviewRows(page)).toHaveCount(3);
    },
  },
  {
    name: 'My reviews showing what is still to do',
    options: reviewer,
    open: async (page) => {
      await page.goto('/northfield/reviews');
      await page.getByRole('button', { name: /^To do/ }).click();
      await expect(page.getByRole('button', { name: /^To do/ })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    },
  },
  {
    name: 'My reviews after a conflict was declared',
    options: reviewer,
    open: async (page) => {
      await page.goto('/northfield/reviews?conflict=declared');
      await expect(
        page.getByRole('status').filter({ hasText: 'You declared a conflict' }),
      ).toBeVisible();
    },
  },
  {
    name: 'My reviews with nothing assigned',
    options: reviewer,
    prepare: (stub) => {
      stub.assignments.splice(0);
    },
    open: async (page) => {
      await page.goto('/northfield/reviews');
      await expect(page.getByRole('heading', { level: 2, name: 'No reviews yet' })).toBeVisible();
    },
  },
  {
    name: 'My reviews while loading',
    options: reviewer,
    setUp: (page) => neverAnswer(page, /\/api\/console\/reviews$/),
    open: async (page) => {
      await page.goto('/northfield/reviews');
      await expect(
        page.getByRole('status').filter({ hasText: 'Loading your reviews' }),
      ).toBeVisible();
    },
  },
  {
    name: 'My reviews that could not be loaded',
    options: reviewer,
    setUp: (page) => failWith(page, /\/api\/console\/reviews$/),
    open: async (page) => {
      await page.goto('/northfield/reviews');
      await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    },
  },
  {
    name: 'My reviews for someone who cannot review',
    options: manager,
    open: async (page) => {
      await page.goto('/northfield/reviews');
      await expect(
        page.getByRole('heading', { level: 2, name: 'You cannot review applications' }),
      ).toBeVisible();
    },
  },
  {
    name: 'the conflict check before scoring',
    options: reviewer,
    open: async (page) => {
      await page.goto('/northfield/reviews');
      await reviewRows(page).nth(0).getByRole('rowheader').getByRole('link').click();
      await expect(
        page.getByRole('button', { name: 'I have no conflict, start scoring' }),
      ).toBeVisible();
    },
  },
  {
    name: 'the scoring workspace',
    options: reviewer,
    open: async (page) => {
      await page.goto('/northfield/reviews');
      await reviewRows(page).nth(1).getByRole('rowheader').getByRole('link').click();
      await expect(page.getByRole('radiogroup')).toHaveCount(3);
    },
  },
  {
    name: 'the scoring workspace with every criterion scored',
    options: reviewer,
    open: async (page) => {
      await page.goto('/northfield/reviews');
      await reviewRows(page).nth(0).getByRole('rowheader').getByRole('link').click();
      await scoreFromTheKeyboard(page, [5, 4, 3]);
      await expect(page.getByText('Every criterion has a score')).toBeVisible();
    },
  },
  {
    name: 'the scoring workspace after submitting too soon',
    options: reviewer,
    open: async (page) => {
      await page.goto('/northfield/reviews');
      await reviewRows(page).nth(1).getByRole('rowheader').getByRole('link').click();
      await page.getByRole('button', { name: 'Submit review' }).click();
      await expect(page.getByRole('alert')).toContainText('Score every criterion to submit');
    },
  },
  {
    name: 'the scoring workspace after a save failed',
    options: reviewer,
    setUp: (page) => failWith(page, /\/api\/console\/reviews\/[^/]+\/scores$/),
    open: async (page) => {
      await page.goto('/northfield/reviews');
      await reviewRows(page).nth(1).getByRole('rowheader').getByRole('link').click();
      await page.getByRole('radio', { name: '3' }).nth(1).focus();
      await page.keyboard.press('3');
      await expect(page.getByText('Not saved. Check your connection and try again')).toBeVisible();
    },
  },
  {
    name: 'a submitted review',
    options: reviewer,
    open: async (page) => {
      await page.goto('/northfield/reviews');
      await reviewRows(page).nth(0).getByRole('rowheader').getByRole('link').click();
      await scoreFromTheKeyboard(page, [5, 4, 3]);
      await page.getByRole('button', { name: 'Submit review' }).click();
      await expect(page.getByText(/Your review is submitted/)).toBeVisible();
    },
  },
  {
    name: 'the dialog for declaring a conflict',
    options: reviewer,
    open: async (page) => {
      await page.goto('/northfield/reviews');
      await reviewRows(page).nth(1).getByRole('rowheader').getByRole('link').click();
      await page
        .getByRole('region', { name: 'Your review' })
        .getByRole('button', { name: 'Declare a conflict' })
        .click();
      await expect(
        page.getByRole('dialog', { name: 'Declare a conflict of interest' }),
      ).toBeVisible();
    },
  },
  {
    name: 'the keyboard shortcuts of the scoring workspace',
    options: reviewer,
    open: async (page) => {
      await page.goto('/northfield/reviews');
      await reviewRows(page).nth(1).getByRole('rowheader').getByRole('link').click();
      await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();
      await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
    },
  },
  {
    name: 'a review that is not on the reviewer’s list',
    options: reviewer,
    open: async (page) => {
      await page.goto('/northfield/reviews/00000000-0000-4000-8000-000000000999');
      await expect(
        page.getByRole('heading', { level: 2, name: 'This review is not on your list' }),
      ).toBeVisible();
    },
  },
  {
    name: 'a review while loading',
    options: reviewer,
    setUp: (page) => neverAnswer(page, /\/api\/console\/reviews\/[^/]+$/),
    open: async (page) => {
      await page.goto('/northfield/reviews/00000000-0000-4000-8000-000000000700');
      await expect(
        page.getByRole('status').filter({ hasText: 'Loading your review' }),
      ).toBeVisible();
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
        const stub = await stubAssessment(page, state.options ?? manager);
        state.prepare?.(stub);
        // Routes added last answer first, so a state's own answer replaces the stand-in's.
        await state.setUp?.(page);
        await state.open(page, stub);
        // A dialog hides the page behind it from the accessibility tree, but the page still has its one heading.
        await expect(page.locator('h1')).toHaveCount(1);

        await expectNoViolations(page);
        await expectNoHorizontalScroll(page);
      });
    }
  });
}
