// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Emergency access page in a real browser, with the API's answers
// stubbed. No restrictable record type is registered yet, so no grant can
// exist to list; the table of grants is covered by a component test, and the
// break-glass journey waits for the first module that registers a type.
// Every spec also fails on a Content Security Policy violation, so the page
// is checked under the production policy in console-production.

import { expect, test } from '../../../scripts/e2e/fixtures.ts';

import { problem, stubSignedIn } from './auth-api.ts';

const SUFFIX = '– Fairfold Grants console';
const allowed = ['platform.break_glass.use'];

test.describe('the emergency access page', () => {
  test('says what to do when no emergency access is open', async ({ page }) => {
    await stubSignedIn(
      page,
      { permissions: allowed },
      {
        'GET /console/break-glass': { status: 200, body: { grants: [] } },
      },
    );
    await page.goto('/northfield/emergency-access');

    await expect(page).toHaveTitle(`Emergency access ${SUFFIX}`);
    await expect(
      page.getByRole('heading', { level: 2, name: 'No emergency access is open' }),
    ).toBeVisible();
    await expect(page.getByText(/an administrator is alerted/)).toBeVisible();
    await expect(page.getByRole('main').getByRole('button')).toHaveCount(0);
  });

  test('shows why the list did not load, and tries again', async ({ page }) => {
    // Busy until the member tries again, however often the page reads: the
    // development server runs each effect twice.
    let busy = true;
    await stubSignedIn(
      page,
      { permissions: allowed },
      {
        'GET /console/break-glass': () =>
          busy
            ? problem(503, 'The service is busy. Try again in a minute.')
            : { status: 200, body: { grants: [] } },
      },
    );
    await page.goto('/northfield/emergency-access');

    await expect(page.getByText('The service is busy. Try again in a minute.')).toBeVisible();
    busy = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('heading', { name: 'No emergency access is open' })).toBeVisible();
  });

  test('tells someone without the permission', async ({ page }) => {
    await stubSignedIn(page, { permissions: [] });
    await page.goto('/northfield/emergency-access');
    await expect(
      page.getByRole('heading', { level: 2, name: 'You cannot open records in an emergency' }),
    ).toBeVisible();
  });
});
