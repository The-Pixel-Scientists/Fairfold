// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The console shell in a real browser: skip link, document title, focus and
// announcements on route changes, back and forward, visible focus, reduced
// motion and the error summary pattern. The signed-in pages open under the
// funder's address with the API stubbed (auth-api.ts); the component gallery
// and the start page sit outside any funder and need no API.

import type { Page } from '@playwright/test';
import { productName } from '@pixel-scientists/domain/platform';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import { stubSignedIn } from './auth-api.ts';

const SUFFIX = `– ${productName} console`;
const START_PAGE = "Use your funder's link";
/** An address that is not a funder's slug, so it is not found without asking the API. */
const NOT_A_FUNDER = '/Not-A-Funder';

/** The text of the polite live region that announces page changes. */
function announcement(page: Page) {
  return page.locator('[aria-live="polite"]');
}

test.describe('programmes page', () => {
  test.beforeEach(async ({ page }) => {
    await stubSignedIn(page);
  });

  test('has a title that says where you are, one h1 and an empty state that says what to do', async ({
    page,
  }) => {
    await page.goto('/northfield/');

    await expect(page).toHaveTitle(`Programmes ${SUFFIX}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1, name: 'Programmes' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'No programmes yet' })).toBeVisible();
    await expect(
      page.getByText('Ask your administrator to set up a programme, or to add you to one'),
    ).toBeVisible();
    await expect(page.getByRole('main')).toContainText('No programmes yet');
  });

  test('has a banner, a main navigation and a main landmark', async ({ page }) => {
    await page.goto('/northfield/');

    await expect(page.getByRole('banner')).toContainText(productName);
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();
    const current = page.getByRole('navigation', { name: 'Main' }).getByRole('link', {
      name: 'Programmes',
    });
    await expect(current).toHaveAttribute('aria-current', 'page');
    // Not colour alone: the current page is underlined, which forced colours keep.
    await expect(current).toHaveCSS('text-decoration-line', 'underline');
  });

  test('leaves focus where the browser put it on the first load', async ({ page }) => {
    await page.goto('/northfield/');
    await expect(page.getByRole('heading', { level: 1, name: 'Programmes' })).toBeVisible();

    const focused = await page.evaluate(() => document.activeElement?.tagName);
    expect(focused).toBe('BODY');
    await expect(announcement(page)).toHaveText('');
  });
});

test.describe('design tokens', () => {
  test('reach the page as CSS custom properties', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: START_PAGE })).toBeVisible();

    const tokens = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      const names = [
        '--color-ink',
        '--color-accent',
        '--color-focus',
        '--text-base',
        '--spacing',
        '--radius-md',
        '--shadow-raised',
        '--focus-ring-width',
        '--motion-fast',
        '--ease-standard',
      ];
      return Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name).trim()]));
    });

    for (const [name, value] of Object.entries(tokens)) expect(value, name).not.toBe('');
    expect(tokens['--color-accent']).toBe('#1f4bb8');
    expect(tokens['--focus-ring-width']).toBe('3px');
  });
});

test.describe('skip link', () => {
  test('is the first Tab stop, shows itself, and moves focus to the main content', async ({
    page,
  }) => {
    await stubSignedIn(page);
    await page.goto('/northfield/');
    await expect(page.getByRole('heading', { level: 1, name: 'Programmes' })).toBeVisible();
    const skipLink = page.getByRole('link', { name: 'Skip to main content' });

    await page.keyboard.press('Tab');

    await expect(skipLink).toBeFocused();
    const box = await skipLink.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.y).toBeGreaterThanOrEqual(0);
    expect(box?.height).toBeGreaterThanOrEqual(24);

    await page.keyboard.press('Enter');

    await expect(page.locator('#main-content')).toBeFocused();
    expect(new URL(page.url()).hash).toBe('');
  });

  test('@gallery puts the next Tab inside the page, past the navigation', async ({ page }) => {
    await page.goto('/dev/components');
    await expect(page.getByRole('heading', { level: 1, name: 'Component gallery' })).toBeVisible();

    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();
    await page.keyboard.press('Tab');

    await expect(page.getByRole('button', { name: 'Save programme' })).toBeFocused();
  });
});

test.describe('moving between pages', () => {
  test('@gallery moves focus to the new h1, updates the title and announces the page', async ({
    page,
  }) => {
    await page.goto('/dev/components');

    await page.getByRole('link', { name: 'Go to the start page' }).focus();
    await page.keyboard.press('Enter');

    const heading = page.getByRole('heading', { level: 1, name: START_PAGE });
    await expect(heading).toBeFocused();
    await expect(heading).toHaveAttribute('tabindex', '-1');
    await expect(page).toHaveTitle(`${START_PAGE} ${SUFFIX}`);
    await expect(page).toHaveURL(/\/$/);
    await expect(announcement(page)).toHaveText(`Navigated to ${START_PAGE}`);
  });

  test('@gallery shows the not found page, with focus on its heading, for an unknown address', async ({
    page,
  }) => {
    await page.goto('/dev/components');
    await page.getByRole('link', { name: 'Open a page that does not exist' }).click();

    const heading = page.getByRole('heading', { level: 1, name: 'Page not found' });
    await expect(heading).toBeFocused();
    await expect(page).toHaveTitle(`Page not found ${SUFFIX}`);
    await expect(announcement(page)).toHaveText('Navigated to Page not found');

    await page.getByRole('link', { name: 'Go to the home page' }).click();
    await expect(page.getByRole('heading', { level: 1, name: START_PAGE })).toBeFocused();
  });

  test('shows the not found page when you open an unknown address directly', async ({ page }) => {
    await page.goto(NOT_A_FUNDER);

    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    await expect(page).toHaveTitle(`Page not found ${SUFFIX}`);
  });

  test('@gallery keeps the title, heading and focus right with the back and forward buttons', async ({
    page,
  }) => {
    await page.goto('/dev/components');
    await page.getByRole('link', { name: 'Go to the start page' }).click();
    await expect(page.getByRole('heading', { level: 1, name: START_PAGE })).toBeFocused();

    await page.goBack();

    await expect(page).toHaveURL(/\/dev\/components$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Component gallery' })).toBeFocused();
    await expect(page).toHaveTitle(`Component gallery ${SUFFIX}`);
    await expect(announcement(page)).toHaveText('Navigated to Component gallery');

    await page.goForward();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1, name: START_PAGE })).toBeFocused();
    await expect(page).toHaveTitle(`${START_PAGE} ${SUFFIX}`);
  });

  test('@gallery scrolls to the top of the new page', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 400 });
    await page.goto('/dev/components');
    await page
      .getByRole('link', { name: 'Open a page that does not exist' })
      .scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

    await page.getByRole('link', { name: 'Open a page that does not exist' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test('@gallery returns to where you were scrolled with the back button, without moving the page again', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 400 });
    await page.goto('/dev/components');
    const link = page.getByRole('link', { name: 'Open a page that does not exist' });
    await link.scrollIntoViewIfNeeded();
    const scrolledTo = await page.evaluate(() => window.scrollY);
    expect(scrolledTo).toBeGreaterThan(0);
    await link.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeFocused();

    await page.goBack();

    await expect(page.getByRole('heading', { level: 1, name: 'Component gallery' })).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(scrolledTo, -1);
  });

  test('@gallery shows and announces "Loading" when a page is slow to arrive', async ({ page }) => {
    await page.route('**/ComponentGalleryPage*', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });
    await page.goto('/');
    const heading = page.getByRole('heading', { level: 1, name: START_PAGE });
    await expect(heading).toBeVisible();
    const before = await heading.boundingBox();
    await page.getByRole('link', { name: 'Component gallery' }).click();

    await expect(page.getByRole('main').getByText('Loading Component gallery…')).toBeVisible();
    await expect(announcement(page)).toHaveText('Loading Component gallery…');
    // The line floats over the page, so nothing moves under a second tap.
    expect((await heading.boundingBox())?.y).toBe(before?.y);

    await expect(page.getByRole('heading', { level: 1, name: 'Component gallery' })).toBeFocused();
    await expect(announcement(page)).toHaveText('Navigated to Component gallery');
  });

  test('shows the error page, with focus, when the first page fails to load', async ({ page }) => {
    await stubSignedIn(page);
    await page.route('**/ProgrammesPage*', (route) => route.abort());
    await page.goto('/northfield/');

    await expect(
      page.getByRole('heading', { level: 1, name: 'This page did not load' }),
    ).toBeFocused();
    await expect(page).toHaveTitle(`This page did not load ${SUFFIX}`);
    await expect(announcement(page)).toHaveText('This page did not load');
    await expect(page.getByRole('button', { name: 'Reload page' })).toBeVisible();
  });
});

test.describe('keyboard and focus', () => {
  test('@gallery shows a visible focus ring, at least 3px wide, on links and buttons', async ({
    page,
  }) => {
    await page.goto('/dev/components');
    await expect(page.getByRole('heading', { level: 1, name: 'Component gallery' })).toBeVisible();

    for (const target of [
      page.getByRole('link', { name: 'Go to the start page' }),
      page.getByRole('button', { name: 'Add reviewer' }),
      page.getByRole('textbox', { name: 'Programme name' }).first(),
    ]) {
      await target.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      const outline = await target.evaluate((element) => {
        const style = getComputedStyle(element);
        return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
      });
      expect(outline.style).toBe('solid');
      expect(outline.width).toBeGreaterThanOrEqual(3);
    }
  });

  test('@gallery makes every button, field and navigation link at least 24 by 24 pixels', async ({
    page,
  }) => {
    await page.goto('/dev/components');
    await expect(page.getByRole('heading', { level: 1, name: 'Component gallery' })).toBeVisible();

    const { checked, small } = await page
      .locator('main button, main input, main textarea, nav a, header a')
      .evaluateAll((elements) => {
        const sizes = elements.map((element) => {
          const box = element.getBoundingClientRect();
          return {
            name: element.textContent || element.getAttribute('name'),
            width: box.width,
            height: box.height,
          };
        });
        return {
          checked: sizes.length,
          small: sizes.filter(({ width, height }) => width < 24 || height < 24),
        };
      });
    expect(checked).toBeGreaterThan(10);
    expect(small).toEqual([]);
  });

  test('does not scroll sideways at 320 px wide', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    for (const path of ['/', NOT_A_FUNDER]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
});

test.describe('reduced motion', () => {
  test('@gallery animates the loading spinner normally', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/dev/components');
    await expect(page.getByRole('heading', { level: 1, name: 'Component gallery' })).toBeVisible();

    const name = await page
      .locator('[role="status"] [aria-hidden="true"]')
      .evaluate((element) => getComputedStyle(element).animationName);
    expect(name).not.toBe('none');
  });

  test('@gallery stops the spinner and every transition when the person asks for reduced motion', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/dev/components');
    await expect(page.getByRole('heading', { level: 1, name: 'Component gallery' })).toBeVisible();

    const spinner = await page
      .locator('[role="status"] [aria-hidden="true"]')
      .evaluate((element) => getComputedStyle(element).animationName);
    expect(spinner).toBe('none');

    const transition = await page
      .getByRole('button', { name: 'Add reviewer' })
      .evaluate((element) => getComputedStyle(element).transitionDuration);
    expect(parseFloat(transition)).toBeLessThanOrEqual(0.001);
  });
});

test.describe('error summary', () => {
  test('@gallery takes focus, links to each field, and clears when the form is valid', async ({
    page,
  }) => {
    await page.goto('/dev/components');

    // The status element is always on the page, and empty until there is something to say.
    const status = page.locator('form:has(#example-name) [role="status"]');
    await expect(status).toHaveText('');
    await page.getByRole('button', { name: 'Check details' }).click();

    const summary = page.getByRole('alert', { name: 'There is a problem' });
    await expect(summary).toBeFocused();
    await expect(summary.getByRole('link')).toHaveText([
      'Enter a programme name',
      'Enter an email address in the format name@example.org',
    ]);

    // Each field says what is wrong, and is described by it.
    const name = page.locator('#example-name');
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    await expect(name).toHaveAccessibleDescription('Error: Enter a programme name');

    // Tab to the first message and press Enter: focus goes to its field.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(name).toBeFocused();
    expect(new URL(page.url()).hash).toBe('');

    await name.fill('Small grants');
    await page.locator('#example-email').fill('team@example.org');
    await page.getByRole('button', { name: 'Check details' }).click();

    await expect(page.getByRole('alert', { name: 'There is a problem' })).toHaveCount(0);
    await expect(status).toHaveText(
      'The details are valid. Nothing was saved, because this is an example.',
    );
    await expect(name).not.toHaveAttribute('aria-invalid', 'true');
  });
});

test.describe('dialogs', () => {
  test('@gallery open with focus inside, trap Tab, close with Escape and give focus back', async ({
    page,
  }) => {
    await page.goto('/dev/components');
    const opener = page.getByRole('button', { name: 'Open dialog' });

    await opener.click();

    const dialog = page.getByRole('dialog', { name: 'Switch funder' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Switch to Eastmere Trust' })).toBeFocused();
    for (let press = 0; press < 4; press += 1) {
      await page.keyboard.press('Tab');
      await expect(dialog.locator(':focus')).toHaveCount(1);
    }
    // The page behind is out of reach of assistive technology while the dialog is open.
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(0);

    await page.keyboard.press('Escape');

    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test('@gallery step-up dialog asks for a password and a code, and says why it failed', async ({
    page,
  }) => {
    await page.goto('/dev/components');
    await page.getByRole('button', { name: 'Open step-up dialog' }).click();

    const dialog = page.getByRole('dialog', { name: 'Confirm it is you' });
    await expect(dialog.getByLabel('Password')).toBeFocused();
    await dialog.getByLabel('Password').fill('correct horse battery');
    await dialog.getByLabel('Code from your authenticator app').fill('123456');
    await dialog.getByRole('button', { name: 'Confirm it is you' }).click();

    await expect(dialog.getByRole('alert', { name: 'There is a problem' })).toBeFocused();
    await expect(dialog).toContainText('Your password or code is not right.');
  });
});

test.describe('with JavaScript off', () => {
  test.use({ javaScriptEnabled: false });

  test('says what to do, in a main landmark under an h1', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('main')).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Turn on JavaScript to use the console' }),
    ).toBeVisible();
  });
});
