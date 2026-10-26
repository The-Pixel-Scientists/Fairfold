// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The programme set-up screens in a real browser, with the API's answers
// stubbed (programme-api.ts): a funder that keeps what is saved. The same
// steps run against the real API in programme-journey.spec.ts. Every spec
// also fails on a Content Security Policy violation, so the screens are
// checked under the production policy in console-production.

import { productName } from '@pixel-scientists/domain/platform';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { problem } from './auth-api.ts';
import { configured, ids, stubProgrammes } from './programme-api.ts';
import {
  addRound,
  addRubric,
  changeEmail,
  checkHistory,
  createProgramme,
  enterMoment,
  h1,
} from './programme-steps.ts';

const SUFFIX = `– ${productName} console`;

/** Playwright dismisses the browser's own confirm and alert dialogs without a word, so note each one. */
function watchNativeDialogs(page: Page): string[] {
  const opened: string[] = [];
  page.on('dialog', (dialog) => {
    opened.push(`${dialog.type()}: ${dialog.message()}`);
    void dialog.dismiss();
  });
  return opened;
}

test.describe('setting up a programme', () => {
  test('goes from an empty list to a programme, its round, a rubric, the emails and the history', async ({
    page,
  }) => {
    await stubProgrammes(page);
    await page.goto('/northfield/');
    await expect(h1(page, 'Programmes')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'No programmes yet' })).toBeVisible();

    await createProgramme(page);
    await expect(page).toHaveTitle(`Programme ${SUFFIX}`);
    await expect(page.getByRole('heading', { level: 3, name: 'No rounds yet' })).toBeVisible();
    await addRound(page);
    await addRubric(page);
    await changeEmail(page, 'Community Spaces Fund');
    await checkHistory(page);
  });

  test('lists the programme with its round once it is set up', async ({ page }) => {
    await stubProgrammes(page, configured());
    await page.goto('/northfield/');

    const row = page.getByRole('row', { name: /Community Spaces Fund/ });
    await expect(row).toContainText('Open');
    await expect(row).toContainText('Autumn 2026');
    await expect(row).toContainText('2 November 2026');
    await expect(row).toContainText('£150,000');
    await row.getByRole('link', { name: 'Community Spaces Fund' }).click();
    await expect(h1(page, 'Community Spaces Fund')).toBeFocused();
  });

  test('is reached from the navigation, with the page title and focus on the heading', async ({
    page,
  }) => {
    await stubProgrammes(page, configured());
    await page.goto('/northfield/programmes/new');
    await expect(h1(page, 'New programme')).toBeVisible();

    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Programmes' })
      .click();

    await expect(h1(page, 'Programmes')).toBeFocused();
    await expect(page).toHaveTitle(`Programmes ${SUFFIX}`);
  });

  test('says what is wrong with a round beside each box and in a summary, and sends nothing', async ({
    page,
  }) => {
    const funder = await stubProgrammes(page, configured());
    await page.goto(`/northfield/programmes/${ids.programme}/rounds/new`);
    await expect(h1(page, 'New round')).toBeVisible();

    await page.getByRole('button', { name: 'Add round' }).click();
    const summary = page.getByRole('alert', { name: 'There is a problem' });
    await expect(summary).toBeFocused();
    await expect(summary.getByRole('link')).toHaveCount(8);
    await expect(page.getByRole('textbox', { name: 'Title' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );

    await page.getByRole('textbox', { name: 'Title' }).fill('Spring 2027');
    await enterMoment(page, 'Opening', ['2', '11', '2026'], '09:00');
    await enterMoment(page, 'Closing', ['12', '10', '2026'], '17:00');
    await page.getByRole('textbox', { name: 'Budget' }).fill('150000');
    await page.getByRole('textbox', { name: 'Smallest award' }).fill('5000');
    await page.getByRole('textbox', { name: 'Largest award' }).fill('25000');
    await page.getByRole('button', { name: 'Add round' }).click();
    await expect(summary).toBeFocused();
    await expect(summary).toContainText(
      'Enter a closing date and time after the opening date and time.',
    );
    await expect(page.getByRole('group', { name: /Closing date/ })).toContainText(
      'Enter a closing date and time after the opening date and time.',
    );
    expect(funder.sent.map(({ key }) => key)).not.toContain(
      `POST /console/programmes/${ids.programme}/rounds`,
    );
  });

  test('keeps the title when the API cannot be reached, and recovers on trying again', async ({
    page,
  }) => {
    let busy = true;
    await stubProgrammes(page, configured(), {
      'GET /console/programmes': () =>
        busy
          ? problem(503, 'The service is busy. Try again in a minute.')
          : { status: 200, body: { programmes: [] } },
    });
    await page.goto('/northfield/');

    await expect(h1(page, 'Programmes')).toBeVisible();
    await expect(page.getByText('The service is busy. Try again in a minute.')).toBeVisible();
    busy = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'No programmes yet' })).toBeVisible();
  });

  test('tells a reviewer they cannot set up programmes, without asking the API for any', async ({
    page,
  }) => {
    const funder = await stubProgrammes(page, configured(), {}, ['grants.reviews.score']);
    await page.goto('/northfield/');

    await expect(
      page.getByRole('heading', { level: 2, name: 'You cannot set up programmes' }),
    ).toBeVisible();
    expect(new Set(funder.sent.map(({ key }) => key))).toEqual(new Set(['GET /auth/session']));
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link')).toHaveText([
      'My reviews',
    ]);
  });
});

test.describe('the stages of a round', () => {
  test('are moved, added, renamed and removed from the keyboard, then saved', async ({ page }) => {
    const funder = await stubProgrammes(page, configured());
    await page.goto(`/northfield/rounds/${ids.round}/stages`);
    await expect(h1(page, 'Stages')).toBeVisible();
    await expect(page.getByRole('textbox', { name: /^Stage name/ })).toHaveCount(3);

    await page.getByRole('button', { name: /^Move down\s*Intake$/ }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: /^Move down\s*Intake$/ })).toBeFocused();
    await expect(page.getByText('Intake moved to position 2 of 3')).toBeAttached();

    await page.getByRole('button', { name: 'Add stage' }).click();
    await expect(page.getByRole('textbox', { name: /^Stage name\s*4$/ })).toBeFocused();
    await page.keyboard.type('Monitoring');
    await page.getByRole('button', { name: /^Remove\s*Decision$/ }).click();
    await page.getByRole('button', { name: 'Save stages' }).click();

    await expect(page.getByText('Stages saved.')).toBeVisible();
    expect(funder.setUp.stages.map((stage) => stage.name)).toEqual([
      'Review',
      'Intake',
      'Monitoring',
    ]);
  });
});

test.describe('leaving a page with changes that are not saved', () => {
  test('opens a dialog, not the browser confirm, and keeps the changes when the person stays', async ({
    page,
  }) => {
    await stubProgrammes(page, configured());
    const native = watchNativeDialogs(page);
    await page.goto(`/northfield/programmes/${ids.programme}/edit`);
    await expect(h1(page, 'Edit programme')).toBeVisible();
    await page.getByRole('textbox', { name: 'Title' }).fill('Community Places Fund');

    await page.getByRole('link', { name: 'Back to programme' }).click();

    const dialog = page.getByRole('dialog', { name: 'Leave this page?' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Stay on this page' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('Community Places Fund');
    expect(native).toEqual([]);

    await page.getByRole('button', { name: 'Save programme' }).click();
    await expect(page.getByText('Programme saved.')).toBeVisible();
    await page.getByRole('link', { name: 'Back to programme' }).click();
    await expect(h1(page, 'Community Places Fund')).toBeFocused();
  });
});
