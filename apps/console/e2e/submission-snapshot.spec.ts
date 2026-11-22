// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Details as submitted on the submission page in a real browser, with the
// API's answers stubbed: an organisation as it was submitted, the same with a
// record that has changed since, and a submission from before snapshots. The
// axe checks cover each state at desktop width, at 320 px wide and at 200%
// zoom; in console-production they run under the production content security
// policy.

import { expect as strictExpect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { expectNoHorizontalScroll, expectNoViolations, variants } from './auth-axe.ts';
import { crowd, detail, stubSubmissions } from './submissions-api.ts';

const expect = strictExpect.configure({ timeout: 15_000 });

const held = crowd();

function second() {
  const found = held[1];
  if (found === undefined) throw new Error('The crowd has no second submission.');
  return found;
}

const target = second();

const registeredAddress = {
  line1: '1 High Street',
  line2: null,
  town: 'Leeds',
  postcode: 'LS1 1AA',
  countryCode: 'GB',
};

const snapshot = {
  id: '00000000-0000-4000-8000-000000009100',
  organisationId: target.organisation.id,
  name: target.organisation.name,
  legalForm: 'registered_charity',
  registeredAddress,
  website: 'https://riverside.example',
  identifiers: [
    { scheme: 'GB-CHC', identifier: '1234567', verifiedAt: '2026-09-01T10:00:00.000Z' },
  ],
  takenBy: '00000000-0000-4000-8000-000000009101',
  takenAt: '2026-10-30T14:30:00.000Z',
};

const current = {
  name: snapshot.name,
  legalForm: snapshot.legalForm,
  registeredAddress,
  website: snapshot.website,
  identifiers: snapshot.identifiers,
  href: `/crm/organisations/${target.organisation.id}`,
};

type Extra = Record<string, unknown>;

const exact: Extra = { organisationSnapshot: snapshot, currentOrganisation: current };
const changed: Extra = {
  organisationSnapshot: snapshot,
  currentOrganisation: { ...current, name: 'Riverside Youth Trust CIO' },
};
const none: Extra = { organisationSnapshot: null };

/** Answers the one submission with `extra` added; every other address is the stub's. */
async function stubDetail(page: Page, extra: Extra): Promise<void> {
  await stubSubmissions(page, held);
  await page.route(
    (url) => url.pathname === `/api/console/submissions/${target.id}`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...detail(target), ...extra }),
      }),
  );
}

const panel = (page: Page) =>
  page.getByRole('region', { name: 'Organisation details as submitted' });

async function open(page: Page, extra: Extra): Promise<void> {
  await stubDetail(page, extra);
  await page.goto(`/northfield/submissions/${target.id}`);
  await expect(panel(page)).toBeVisible();
}

test.describe('details as submitted', () => {
  test('shows the organisation as submitted', async ({ page }) => {
    await open(page, exact);

    await expect(panel(page)).toContainText('1 High Street, Leeds, LS1 1AA');
    await expect(panel(page)).toContainText('Verified');
    await expect(panel(page).getByRole('link')).toHaveCount(0);
  });

  test('says what changed and links to the current record', async ({ page }) => {
    await open(page, changed);

    await expect(panel(page)).toContainText(
      "The organisation's name has changed since this was submitted.",
    );
    await expect(panel(page).getByRole('link', { name: 'See the current record' })).toBeVisible();
  });

  test('says plainly when details were not recorded', async ({ page }) => {
    await open(page, none);

    await expect(panel(page)).toContainText(
      'Details as submitted were not recorded for this submission.',
    );
  });
});

const states: { name: string; extra: Extra }[] = [
  { name: 'a snapshot', extra: exact },
  { name: 'a changed record', extra: changed },
  { name: 'no snapshot', extra: none },
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
        await open(page, state.extra);
        await expect(page.locator('h1')).toHaveCount(1);

        await expectNoViolations(page);
        await expectNoHorizontalScroll(page);
      });
    }
  });
}
