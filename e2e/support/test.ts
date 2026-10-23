// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `test` for the journey: the shared one, which fails on a Content Security
// Policy violation, plus pages for people who are signed in. A person signs in
// once and the session is kept for the later steps, so the journey spends few
// authenticator codes; a session that has ended, or has not been made, is
// replaced by a fresh sign-in. Every page opened here is checked for policy
// violations and closed when the test ends.

import { existsSync } from 'node:fs';

import type { BrowserContext, Page } from '@playwright/test';

import { expect, test as base, watchSecurityPolicy } from '../../scripts/e2e/fixtures.ts';
import {
  consoleOrigin,
  journeyEnabled,
  journeySkipReason,
  portalOrigin,
  stateFile,
  type Slug,
} from './env.ts';
import { person } from './state.ts';
import { nextCode, rememberKey } from './totp.ts';

export { expect };

/**
 * Every journey spec starts with this: its tests run in order, one worker, and
 * only on a stack that was seeded for the journey.
 */
export function inOrder(): void {
  base.describe.configure({ mode: 'serial', timeout: 240_000 });
  base.use({ actionTimeout: 30_000, navigationTimeout: 30_000 });
  base.skip(!journeyEnabled, journeySkipReason);
}

export const h1 = (page: Page, name: string | RegExp) =>
  page.getByRole('heading', { level: 1, name });

async function signInStaffPage(page: Page, slug: Slug, name: string): Promise<void> {
  const { email, password } = person(name);
  await page.goto(`/${slug}/sign-in`);
  await page.getByRole('textbox', { name: 'Email address' }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  const setUp = h1(page, 'Set up your authenticator app');
  const enter = h1(page, 'Enter your code');
  await expect(setUp.or(enter)).toBeVisible();
  if (await setUp.isVisible()) {
    const shown = await page.getByText(/^[A-Z2-7]{4}( [A-Z2-7]{4})+$/).textContent();
    rememberKey(name, (shown ?? '').replace(/\s/g, ''));
    await page.getByLabel('Code from your app').fill(await nextCode(name));
    await page.getByRole('button', { name: 'Finish set-up' }).click();
  } else {
    await page.getByLabel('Code from your app').fill(await nextCode(name));
    await page.getByRole('button', { name: 'Confirm code' }).click();
  }
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
}

async function signInApplicantPage(page: Page, slug: Slug, name: string): Promise<void> {
  const { email, password } = person(name);
  await page.goto(`/${slug}/sign-in`);
  await page.getByRole('textbox', { name: 'Email address' }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(h1(page, 'Apply for a grant')).toBeVisible();
}

export interface Pages {
  /** A page signed in to a tenant's console as seeded or created staff; `fresh` signs in again whatever was kept. */
  staff: (name: string, slug?: Slug, fresh?: boolean) => Promise<Page>;
  /** A page signed in to a tenant's portal as an applicant made by an earlier step. */
  applicant: (name: string, slug?: Slug) => Promise<Page>;
  /** A page with no one signed in, on the portal or the console. */
  visitor: (app?: 'portal' | 'console') => Promise<Page>;
}

export const test = base.extend<{ pages: Pages }>({
  pages: async ({ browser }, use) => {
    const opened: { context: BrowserContext; violations: () => Promise<string[]> }[] = [];

    async function open(
      origin: string,
      name: string | null,
      signIn: (page: Page) => Promise<void>,
      fresh = false,
    ) {
      const file = name === null ? null : `${stateFile}.${name}.session.json`;
      const make = async (stored: boolean) => {
        const context = await browser.newContext({
          baseURL: origin,
          ...(stored && file !== null ? { storageState: file } : {}),
        });
        opened.push({ context, violations: await watchSecurityPolicy(context) });
        return context;
      };
      if (!fresh && file !== null && existsSync(file)) {
        const context = await make(true);
        const session = await context.request.get('/api/auth/session');
        if (session.ok()) return context.newPage();
        opened.pop();
        await context.close();
      }
      const context = await make(false);
      const page = await context.newPage();
      await signIn(page);
      if (file !== null) await context.storageState({ path: file });
      return page;
    }

    await use({
      staff: (name, slug = 'northfield', fresh = false) =>
        open(consoleOrigin, name, (page) => signInStaffPage(page, slug, name), fresh),
      applicant: (name, slug = 'northfield') =>
        open(portalOrigin, name, (page) => signInApplicantPage(page, slug, name)),
      visitor: (app = 'portal') =>
        open(app === 'portal' ? portalOrigin : consoleOrigin, null, () => Promise.resolve()),
    });

    for (const { context, violations } of opened) {
      expect(await violations(), 'The page broke its Content Security Policy').toEqual([]);
      await context.close();
    }
  },
});

export type { Page };
