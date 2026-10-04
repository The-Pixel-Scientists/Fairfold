// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The portal's first screens in a real browser: skip link, document title,
// focus and announcements on route changes, back and forward, reflow at 320 px
// and 200% zoom, text spacing, visible focus and what loads over the network.

// The callbacks passed to page.evaluate run in the browser, so they use DOM types.
/// <reference lib="dom" />

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { productName } from '@pixel-scientists/domain/platform';

const SUFFIX = `– ${productName}`;

/** The text of the polite live region that announces page changes. */
function announcement(page: Page) {
  return page.locator('[aria-live="polite"]');
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

test.describe('home page', () => {
  test('has a title that says where you are, one h1 and plain words about what happens next', async ({
    page,
  }) => {
    await page.goto('/');

    await expect(page).toHaveTitle(`Apply for a grant ${SUFFIX}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1, name: 'Apply for a grant' })).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: 'No grants are open yet' }),
    ).toBeVisible();
    await expect(page.getByText('You do not need to do anything now.')).toBeVisible();
    await expect(
      page.getByText(
        'When a grant opens, you will check that you can apply first. Then you will fill in your application at your own pace.',
      ),
    ).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');
  });

  test('has a banner and a main landmark, and no navigation to wade through', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('banner')).toContainText(productName);
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('navigation')).toHaveCount(0);
  });

  test('leaves focus where the browser put it on the first load', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Apply for a grant' })).toBeVisible();

    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BODY');
    await expect(announcement(page)).toHaveText('');
  });

  test('shows a heading larger than the opening text, in a column that is easy to read', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Apply for a grant' })).toBeVisible();

    const sizes = await page.evaluate(() => ({
      heading: parseFloat(getComputedStyle(document.querySelector('h1') as Element).fontSize),
      body: parseFloat(getComputedStyle(document.body).fontSize),
      lede: parseFloat(getComputedStyle(document.querySelector('main p') as Element).fontSize),
      column: (document.querySelector('main > div > div') as Element).getBoundingClientRect().width,
    }));
    expect(sizes.heading).toBeGreaterThan(sizes.lede);
    expect(sizes.lede).toBeGreaterThan(sizes.body);
    expect(sizes.column).toBeLessThanOrEqual(672);
  });
});

test.describe('skip link', () => {
  test('is the first Tab stop, shows itself, and moves focus to the main content', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Apply for a grant' })).toBeVisible();
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

  test('puts the next Tab on the first link in the page', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Apply for a grant' })).toBeVisible();

    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');

    await expect(page.getByRole('link', { name: 'Read how applying works' })).toBeFocused();
  });
});

test.describe('moving between pages', () => {
  test('moves focus to the new h1, updates the title and announces the page', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('link', { name: 'Read how applying works' }).focus();
    await page.keyboard.press('Enter');

    const heading = page.getByRole('heading', { level: 1, name: 'How applying works' });
    await expect(heading).toBeFocused();
    await expect(heading).toHaveAttribute('tabindex', '-1');
    await expect(page).toHaveTitle(`How applying works ${SUFFIX}`);
    await expect(page).toHaveURL(/\/how-applying-works$/);
    await expect(announcement(page)).toHaveText('Navigated to How applying works');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  });

  test('goes home from the link at the end of the page, with focus on the home heading', async ({
    page,
  }) => {
    await page.goto('/how-applying-works');

    await page.getByRole('link', { name: 'Back to the home page' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Apply for a grant' })).toBeFocused();
    await expect(page).toHaveTitle(`Apply for a grant ${SUFFIX}`);
    await expect(page).toHaveURL(/\/$/);
  });

  test('shows the not found page for an unknown address, and a way home', async ({ page }) => {
    await page.goto('/no-such-page');

    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    await expect(page).toHaveTitle(`Page not found ${SUFFIX}`);

    await page.getByRole('link', { name: 'Go to the home page' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Apply for a grant' })).toBeFocused();
    await expect(announcement(page)).toHaveText('Navigated to Apply for a grant');
  });

  test('goes home from the product name in the header, with focus on the home heading', async ({
    page,
  }) => {
    await page.goto('/how-applying-works');
    const home = page.getByRole('banner').getByRole('link', { name: productName });
    await expect(home).toHaveAttribute('href', '/');
    await expect(home).not.toHaveAttribute('aria-current');

    await home.click();

    await expect(page.getByRole('heading', { level: 1, name: 'Apply for a grant' })).toBeFocused();
    await expect(page).toHaveTitle(`Apply for a grant ${SUFFIX}`);
    await expect(page).toHaveURL(/\/$/);
    await expect(home).toHaveAttribute('aria-current', 'page');
  });

  test('keeps the title, heading and focus right with the back and forward buttons', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Read how applying works' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'How applying works' })).toBeFocused();

    await page.goBack();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Apply for a grant' })).toBeFocused();
    await expect(page).toHaveTitle(`Apply for a grant ${SUFFIX}`);
    await expect(announcement(page)).toHaveText('Navigated to Apply for a grant');

    await page.goForward();

    await expect(page).toHaveURL(/\/how-applying-works$/);
    await expect(page.getByRole('heading', { level: 1, name: 'How applying works' })).toBeFocused();
    await expect(page).toHaveTitle(`How applying works ${SUFFIX}`);
  });

  test('scrolls to the top of the new page', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 400 });
    await page.goto('/how-applying-works');
    await page.getByRole('link', { name: 'Back to the home page' }).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

    await page.getByRole('link', { name: 'Back to the home page' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Apply for a grant' })).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });
});

const HOW_APPLYING_WORKS_CODE = '**/HowApplyingWorksPage.tsx*';

test.describe('a page that is slow or fails to load', () => {
  test('shows and announces that the page is loading, then moves to it', async ({ page }) => {
    await page.route(HOW_APPLYING_WORKS_CODE, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });
    await page.goto('/');

    await page.getByRole('link', { name: 'Read how applying works' }).click();

    await expect(page.getByRole('main').getByText('Loading How applying works…')).toBeVisible();
    await expect(announcement(page)).toHaveText('Loading How applying works…');
    await expect(page.getByRole('heading', { level: 1, name: 'How applying works' })).toBeFocused();
  });

  test('says what to do in plain words, takes focus, and reloads when asked', async ({ page }) => {
    await page.route(HOW_APPLYING_WORKS_CODE, (route) => route.abort());
    await page.goto('/');

    await page.getByRole('link', { name: 'Read how applying works' }).click();

    const heading = page.getByRole('heading', { level: 1, name: 'We could not load this page' });
    await expect(heading).toBeFocused();
    await expect(page).toHaveTitle(`We could not load this page ${SUFFIX}`);
    await expect(announcement(page)).toHaveText('We could not load this page');
    await expect(page.getByRole('main')).toContainText(
      'Check that you are online, then reload the page.',
    );
    await expect(page.getByRole('main')).not.toContainText(/administrator/i);

    await page.unroute(HOW_APPLYING_WORKS_CODE);
    await page.getByRole('button', { name: 'Reload page' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'How applying works' })).toBeVisible();
  });
});

test.describe('how applying works page', () => {
  test('lists four steps in order, and says results appear only after release', async ({
    page,
  }) => {
    await page.goto('/how-applying-works');

    await expect(page.getByRole('heading', { level: 2 })).toHaveText([
      'Step 1Check you can apply',
      'Step 2Write your application',
      'Step 3Check and send',
      'Step 4Wait for the decision',
    ]);
    await expect(page.getByRole('listitem')).toHaveCount(4);
    await expect(page.getByText('only after the funder has released it')).toBeVisible();
  });

  test('opens by saying nobody can apply yet, and describes the steps in the future tense', async ({
    page,
  }) => {
    await page.goto('/how-applying-works');

    await expect(
      page.getByText(
        'No grants are open yet, so you cannot apply today. This is how applying will work.',
      ),
    ).toBeVisible();
    await expect(page.getByText('We will save your answers as you go.')).toBeVisible();
  });
});

test.describe('small screens, zoom and text spacing', () => {
  test('does not scroll sideways at 320 px wide', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    for (const path of ['/', '/how-applying-works', '/no-such-page']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await horizontalOverflow(page), path).toBeLessThanOrEqual(0);
    }
  });

  test.describe('at 200% zoom', () => {
    test.use({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 2 });

    test('does not scroll sideways, and keeps the text readable', async ({ page }) => {
      for (const path of ['/', '/how-applying-works', '/no-such-page']) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        expect(await horizontalOverflow(page), path).toBeLessThanOrEqual(0);
      }
    });
  });

  test('does not clip or push words sideways with the wider text spacing of WCAG 1.4.12', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    for (const path of ['/', '/how-applying-works']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.addStyleTag({
        content:
          '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }',
      });

      expect(await horizontalOverflow(page), path).toBeLessThanOrEqual(0);
      const clipped = await page.evaluate(() =>
        Array.from(document.querySelectorAll('main *'))
          .filter((element) => element.scrollWidth > element.clientWidth + 1)
          .map((element) => element.tagName),
      );
      expect(clipped, path).toEqual([]);
    }
  });
});

test.describe('keyboard and touch', () => {
  test('shows a visible focus ring, at least 3px wide, on the header link and the page link', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Apply for a grant' })).toBeVisible();

    await page.keyboard.press('Tab');
    for (const name of [productName, 'Read how applying works']) {
      await page.keyboard.press('Tab');
      const link = page.getByRole('link', { name });
      await expect(link).toBeFocused();
      const outline = await link.evaluate((element) => {
        const style = getComputedStyle(element);
        return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
      });
      expect(outline.style, name).toBe('solid');
      expect(outline.width, name).toBeGreaterThanOrEqual(3);
    }
  });

  test('makes the header link at least 24 pixels tall (WCAG 2.5.8)', async ({ page }) => {
    await page.goto('/');
    const box = await page
      .getByRole('banner')
      .getByRole('link', { name: productName })
      .boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(24);
  });

  test('makes every link in the page at least 44 pixels tall, for thumbs and unsteady hands', async ({
    page,
  }) => {
    for (const path of ['/', '/how-applying-works', '/no-such-page']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

      const { checked, small } = await page.locator('main a').evaluateAll((elements) => ({
        checked: elements.length,
        small: elements
          .map((element) => ({
            name: element.textContent,
            height: element.getBoundingClientRect().height,
          }))
          .filter(({ height }) => height < 44),
      }));
      expect(checked, path).toBeGreaterThan(0);
      expect(small, path).toEqual([]);
    }
  });
});

test.describe('reduced motion', () => {
  test('stops every transition when the person asks for reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Apply for a grant' })).toBeVisible();

    const transition = await page
      .getByRole('link', { name: 'Read how applying works' })
      .evaluate((element) => getComputedStyle(element).transitionDuration);
    expect(parseFloat(transition)).toBeLessThanOrEqual(0.001);
  });
});

test.describe('network', () => {
  test('loads everything from the portal itself, with no third-party fonts or scripts', async ({
    page,
  }) => {
    const origins = new Set<string>();
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.protocol === 'http:' || url.protocol === 'https:') origins.add(url.origin);
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Apply for a grant' })).toBeVisible();
    await page.getByRole('link', { name: 'Read how applying works' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'How applying works' })).toBeFocused();

    expect([...origins]).toEqual([new URL(page.url()).origin]);
  });
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('says what to do, in a page with a heading and a main landmark', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveTitle(productName);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Turn on JavaScript to apply' }),
    ).toBeVisible();
    await expect(page.getByRole('main')).toContainText('Turn it on in your browser settings');
  });
});
