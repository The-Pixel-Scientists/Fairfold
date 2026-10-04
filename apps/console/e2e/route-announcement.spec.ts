// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What a change of page does to the polite live region and to focus, watched
// from inside the page (ADR 0014): one message for each page, focus on the
// new h1, and nothing at all for a change of search string. The live region
// is recorded with a MutationObserver, so a message that was added and
// replaced within the same moment still shows. This proves the page does one
// thing for each route change; what a screen reader then says is checked by
// hand, in the pairs the accessibility audit uses.
//
// The tests are tagged @a11y so they also run on the production build in
// Firefox and WebKit. They use the settings pages, which are lazy, and the
// funder's API stubbed (settings-api.ts).

import type { Locator, Page } from '@playwright/test';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import { stubSettings } from './settings-api.ts';

const SUFFIX = '– Fairfold Grants console';
/** Longer than the router's 400 ms wait before it says a page is loading, so a late message would show. */
const SETTLE_MS = 700;
/** Long enough to cross that wait, short enough for a test. */
const SLOW_PAGE_MS = 1500;

const announcement = (page: Page) => page.locator('[aria-live="polite"]');
const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });
const mainNavigation = (page: Page) => page.getByRole('navigation', { name: 'Main' });
const settingsSections = (page: Page) => page.getByRole('navigation', { name: 'Settings' });

/** What the page did from the moment recording began. */
interface Recording {
  /** The text of each message put into the live region, in order. */
  messages: string[];
  /** Every change to the live region, of any kind. */
  changes: number;
  /** The text of each heading that took focus. */
  headingsFocused: string[];
  /** Every element that took focus. */
  focused: number;
}

/** Start watching the live region and focus; the returned function reads what was seen. */
async function record(page: Page): Promise<() => Promise<Recording>> {
  await page.evaluate(() => {
    const region = document.querySelector('[aria-live="polite"]');
    if (region === null) throw new Error('The page has no live region.');
    const seen: Recording = { messages: [], changes: 0, headingsFocused: [], focused: 0 };
    new MutationObserver((records) => {
      for (const change of records) {
        seen.changes += 1;
        for (const node of change.addedNodes) seen.messages.push(node.textContent ?? '');
        if (change.type === 'characterData') seen.messages.push(change.target.textContent ?? '');
      }
    }).observe(region, { childList: true, subtree: true, characterData: true });
    document.addEventListener('focusin', (event) => {
      seen.focused += 1;
      if (event.target instanceof HTMLHeadingElement) {
        seen.headingsFocused.push(event.target.textContent);
      }
    });
    Object.assign(window, { routeRecording: seen });
  });
  return () =>
    page.evaluate(() => (window as unknown as { routeRecording: Recording }).routeRecording);
}

/** Give a late second update, if there is going to be one, the time to arrive. */
async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(SETTLE_MS);
}

/**
 * Go to a page and come back, so its file is loaded and the next visit shows it
 * at once. A page that has to be fetched can be slow, and then the router says
 * "Loading" first; the slow page test is the one that looks at that.
 */
async function visitAndReturn(page: Page, link: Locator, heading: string, back: string) {
  await link.click();
  await expect(h1(page, heading)).toBeFocused();
  await page.goBack();
  await expect(h1(page, back)).toBeFocused();
}

/** Answer a lazy page's file late, so the page is slow to arrive. */
async function slowPage(page: Page, file: string): Promise<void> {
  await page.route(`**/${file}*`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, SLOW_PAGE_MS));
    await route.continue();
  });
}

test.describe('route announcements', () => {
  test.beforeEach(async ({ page }) => {
    await stubSettings(page);
  });

  test('@a11y says nothing on the first load, then announces a new page once with focus on its h1', async ({
    page,
  }) => {
    await page.goto('/northfield/');
    await expect(h1(page, 'Programmes')).toBeVisible();
    await expect(announcement(page)).toHaveText('');
    const settings = mainNavigation(page).getByRole('link', { name: 'Settings' });
    await visitAndReturn(page, settings, 'General settings', 'Programmes');
    const read = await record(page);

    await settings.click();

    await expect(h1(page, 'General settings')).toBeFocused();
    await expect(page).toHaveTitle(`General settings ${SUFFIX}`);
    await expect(announcement(page)).toHaveText('Navigated to General settings');
    await settle(page);
    const seen = await read();
    expect(seen.messages).toEqual(['Navigated to General settings']);
    expect(seen.headingsFocused).toEqual(['General settings']);
    await expect(announcement(page).locator('span')).toHaveCount(1);
  });

  test('@a11y announces each page once when you press Enter on a link', async ({ page }) => {
    await page.goto('/northfield/settings');
    await expect(h1(page, 'General settings')).toBeVisible();
    const look = settingsSections(page).getByRole('link', { name: 'Look', exact: true });
    await visitAndReturn(page, look, 'Look and logo', 'General settings');
    const read = await record(page);

    await look.focus();
    await page.keyboard.press('Enter');

    await expect(h1(page, 'Look and logo')).toBeFocused();
    await settle(page);
    const seen = await read();
    expect(seen.messages).toEqual(['Navigated to Look and logo']);
    expect(seen.headingsFocused).toEqual(['Look and logo']);
  });

  test('@a11y moves a slow page from "Loading" to one "Navigated to" message', async ({ page }) => {
    await slowPage(page, 'GeneralPage');
    await page.goto('/northfield/');
    await expect(h1(page, 'Programmes')).toBeVisible();
    const read = await record(page);

    await mainNavigation(page).getByRole('link', { name: 'Settings' }).click();

    await expect(announcement(page)).toHaveText('Loading General settings…');
    await expect(h1(page, 'General settings')).toBeFocused();
    await expect(announcement(page)).toHaveText('Navigated to General settings');
    await settle(page);
    const seen = await read();
    expect(seen.messages).toEqual(['Loading General settings…', 'Navigated to General settings']);
    expect(seen.headingsFocused).toEqual(['General settings']);
    await expect(announcement(page).locator('span')).toHaveCount(1);
  });

  test('@a11y ends on the error message, with focus on its h1, when a page fails to load', async ({
    page,
  }) => {
    await page.route('**/GeneralPage*', (route) => route.abort());
    await page.goto('/northfield/');
    await expect(h1(page, 'Programmes')).toBeVisible();

    await mainNavigation(page).getByRole('link', { name: 'Settings' }).click();

    await expect(h1(page, 'This page did not load')).toBeFocused();
    await expect(page).toHaveTitle(`This page did not load ${SUFFIX}`);
    await settle(page);
    await expect(announcement(page)).toHaveText('This page did not load');
    await expect(announcement(page).locator('span')).toHaveCount(1);
  });

  test('@a11y announces once for each back and forward, including a page that is not found', async ({
    page,
  }) => {
    await page.goto('/northfield/no-such-page');
    await expect(h1(page, 'Page not found')).toBeVisible();
    await expect(announcement(page)).toHaveText('');
    await page.getByRole('link', { name: 'Go to the home page' }).click();
    await expect(h1(page, 'Programmes')).toBeFocused();
    await page.goBack();
    await expect(h1(page, 'Page not found')).toBeFocused();
    await page.goForward();
    await expect(h1(page, 'Programmes')).toBeFocused();
    const read = await record(page);

    await page.goBack();
    await expect(h1(page, 'Page not found')).toBeFocused();
    await expect(announcement(page)).toHaveText('Navigated to Page not found');
    await expect(page).toHaveTitle(`Page not found ${SUFFIX}`);
    await settle(page);
    await page.goForward();
    await expect(h1(page, 'Programmes')).toBeFocused();
    await expect(announcement(page)).toHaveText('Navigated to Programmes');
    await expect(page).toHaveTitle(`Programmes ${SUFFIX}`);
    await settle(page);

    const seen = await read();
    expect(seen.messages).toEqual(['Navigated to Page not found', 'Navigated to Programmes']);
    expect(seen.headingsFocused).toEqual(['Page not found', 'Programmes']);
    await expect(announcement(page).locator('span')).toHaveCount(1);
  });

  test('@a11y leaves the live region and focus alone when only the search string changes', async ({
    page,
  }) => {
    await page.goto('/northfield/settings?view=first');
    const name = page.getByRole('textbox', { name: 'Funder name' });
    await expect(name).toBeVisible();
    await name.focus();
    // Another history entry for the same page: stepping back and forward between
    // the two is a change of search string alone.
    await page.evaluate(() => {
      window.history.pushState(window.history.state, '', '?view=second');
    });
    const read = await record(page);

    await page.goBack();
    await expect(page).toHaveURL(/\?view=first$/);
    await settle(page);
    await page.goForward();
    await expect(page).toHaveURL(/\?view=second$/);
    await settle(page);

    const seen = await read();
    expect(seen.changes).toBe(0);
    expect(seen.focused).toBe(0);
    await expect(name).toBeFocused();
    await expect(announcement(page)).toHaveText('');
    await expect(h1(page, 'General settings')).toBeVisible();
  });
});
