// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The assure screens with the API stubbed and synthetic data only: the
// registry panel and its refresh, the queue of possible matches, a match and
// its decision with step-up, and assure switched off. The names and numbers
// are invented.

import { expect as strictExpect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { consoleSession, problem } from './auth-api.ts';
import type { Handler, SentRequest } from './auth-api.ts';
import { stubSignedIn } from './auth-api.ts';
import { expectNoHorizontalScroll, expectNoViolations, variants } from './auth-axe.ts';

/** Each page loads its code when first opened, which a busy machine can slow past five seconds. */
const expect = strictExpect.configure({ timeout: 15_000 });

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const organisation = uuid(1);
const match = uuid(2);
const STEP_UP_NEEDED = 'Confirm it is you again, then try again.';

const everything = [
  'assure.lookup.read',
  'assure.lookup.run',
  'assure.screening.read',
  'assure.screening.decide',
];

const ok = (body: unknown): Handler => ({ status: 200, body });

const snapshot = (fetchedAt: string) => ({
  id: uuid(10),
  registry: 'charity_commission',
  identifier: '1000001',
  fetchedAt,
  outcome: 'found',
  details: {
    status: 'registered',
    registeredName: 'Riverside Lunch Club',
    registeredAddress: null,
    registeredOn: '2001-04-05',
    removedOn: null,
    accounts: null,
    accountsOverdue: null,
    officerCount: 0,
  },
});

const summary = {
  id: match,
  runId: uuid(30),
  partyId: uuid(31),
  subjectPartyId: null,
  nameSource: 'registered_name',
  entryKind: 'entity',
  similarity: 0.87,
  status: 'open',
  raisedAt: '2026-12-01T10:00:00.000Z',
};

const detail = {
  ...summary,
  screenedName: 'Riverside Lunch Club',
  officerId: null,
  entry: {
    designationId: 'TEST0001',
    name: 'Riverbank Lunch Society',
    regime: 'Test regime',
    designatedOn: '2020-02-03',
    datesOfBirth: [],
    nationalities: [],
    country: 'Testland',
  },
  list: { id: uuid(32), publishedOn: '2026-11-30', downloadedAt: '2026-12-01T06:00:00.000Z' },
  decisions: [],
};

const decision = {
  id: uuid(40),
  outcome: 'not_a_match',
  reason: 'different_name',
  decidedAt: '2026-12-03T14:05:00.000Z',
  decidedBy: uuid(900),
};

const LOOKUPS = `/console/organisations/${organisation}/lookups`;

function stub(
  page: Page,
  options: { permissions?: string[]; modules?: string[]; more?: Record<string, Handler> } = {},
): Promise<SentRequest[]> {
  const { permissions = everything, modules = ['grants', 'assure'], more = {} } = options;
  return stubSignedIn(
    page,
    { permissions, modules },
    {
      [`GET ${LOOKUPS}`]: ok({
        snapshots: [snapshot('2026-10-01T10:00:00.000Z')],
        notSetUp: ['oscr'],
      }),
      'GET /console/screening-matches': ok({ matches: [summary], nextCursor: null }),
      [`GET /console/screening-matches/${match}`]: ok(detail),
      ...more,
    },
  );
}

test.describe('registry panel', () => {
  test('shows the source and fetched time, and a refresh updates it', async ({ page }) => {
    let refreshed = false;
    const sent = await stub(page, {
      more: {
        [`GET ${LOOKUPS}`]: () => ({
          status: 200,
          body: {
            snapshots: [
              snapshot(refreshed ? '2026-12-03T14:05:00.000Z' : '2026-10-01T10:00:00.000Z'),
            ],
            notSetUp: [],
          },
        }),
        [`POST ${LOOKUPS}`]: () => {
          refreshed = true;
          return {
            status: 202,
            body: {
              jobId: uuid(20),
              registry: 'charity_commission',
              queuedAt: '2026-12-03T14:04:00Z',
            },
          };
        },
      },
    });
    await page.goto(`/northfield/assure/organisations/${organisation}`);

    await expect(
      page.getByText(/From the Charity Commission register\. Fetched 1 October/),
    ).toBeVisible();
    await expect(page.getByText('Out of date')).toBeVisible();
    await page
      .getByRole('button', { name: 'Refresh registry details from Charity Commission' })
      .click();

    await expect(page.getByRole('status').filter({ hasText: 'are up to date' })).toHaveText(
      'Charity Commission details are up to date.',
    );
    await expect(page.getByText(/Fetched 3 December 2026 at/)).toBeVisible();
    expect(sent.filter(({ key }) => key === `POST ${LOOKUPS}`)).toHaveLength(1);
  });

  test('keeps focus on the officers button and lists the names beside it', async ({ page }) => {
    await stub(page, {
      more: {
        [`GET ${LOOKUPS}`]: ok({
          snapshots: [
            {
              ...snapshot('2026-10-01T10:00:00.000Z'),
              details: { ...snapshot('x').details, officerCount: 1 },
            },
          ],
          notSetUp: [],
        }),
        [`GET /console/lookups/${uuid(10)}/officers`]: ok({
          officers: [{ id: uuid(41), name: 'Ada Example', role: 'trustee', personId: null }],
        }),
      },
    });
    await page.goto(`/northfield/assure/organisations/${organisation}`);
    const button = page.getByRole('button', {
      name: 'Show 1 officer or trustee from Charity Commission',
    });
    await button.click();

    await expect(page.getByText('Ada Example')).toBeVisible();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(button).toBeFocused();
  });

  test('shows the words a failed refresh comes with', async ({ page }) => {
    await stub(page, {
      more: {
        [`POST ${LOOKUPS}`]: problem(429, 'The register is busy. Try again in a few minutes.'),
      },
    });
    await page.goto(`/northfield/assure/organisations/${organisation}`);
    await page
      .getByRole('button', { name: 'Refresh registry details from Charity Commission' })
      .click();

    await expect(page.getByText('The register is busy. Try again in a few minutes.')).toBeVisible();
  });
});

test.describe('matches', () => {
  test('lists a match, opens it, and a decision with step-up leaves the queue', async ({
    page,
  }) => {
    let decided = false;
    let tries = 0;
    const sent = await stub(page, {
      more: {
        'GET /console/screening-matches': () => ({
          status: 200,
          body: { matches: decided ? [] : [summary], nextCursor: null },
        }),
        [`GET /console/screening-matches/${match}`]: () => ({
          status: 200,
          body: { ...detail, decisions: decided ? [decision] : [] },
        }),
        [`POST /console/screening-matches/${match}/decisions`]: () => {
          tries += 1;
          if (tries === 1) return problem(403, STEP_UP_NEEDED);
          decided = true;
          return { status: 201, body: decision };
        },
        'POST /auth/step-up': ok(
          consoleSession({ permissions: everything, modules: ['grants', 'assure'] }),
        ),
      },
    });
    await page.goto('/northfield/assure/matches');

    const table = page.getByRole('table', { name: 'Possible matches' });
    await expect(table.getByText('87%')).toBeVisible();
    await table.getByRole('link', { name: '1 December 2026' }).click();
    await expect(
      page.getByText(/It is advisory\. Nothing has been blocked or rejected/),
    ).toBeVisible();
    await expect(page.getByText('Riverbank Lunch Society')).toBeVisible();

    await page.getByRole('button', { name: 'Record decision' }).click();
    const dialog = page.getByRole('dialog', { name: 'Record decision' });
    await dialog.getByRole('radio', { name: 'Not a match' }).check();
    await dialog.getByLabel('Reason').selectOption('different_name');
    await dialog.getByRole('button', { name: 'Confirm decision' }).click();

    const confirm = page.getByRole('dialog', { name: 'Confirm it is you' });
    await confirm.getByLabel('Password').fill('correct horse battery');
    await confirm.getByLabel(/Code from your authenticator app/).fill('123456');
    await confirm.getByRole('button', { name: 'Confirm it is you' }).click();

    const heading = page.getByRole('heading', { name: 'Decision recorded: Not a match' });
    await expect(heading).toBeFocused();

    const posts = sent.filter(({ key }) => key.endsWith('/decisions'));
    expect(posts.at(-1)?.body).toEqual({ outcome: 'not_a_match', reason: 'different_name' });
    expect(JSON.stringify(posts)).not.toMatch(/member|tenant|decider/i);

    await page.goto('/northfield/assure/matches');
    await expect(page.getByText('No matches to review')).toBeVisible();
  });

  test('offers no decision to a member without the permission', async ({ page }) => {
    await stub(page, { permissions: ['assure.screening.read'] });
    await page.goto(`/northfield/assure/matches/${match}`);

    await expect(page.getByRole('heading', { level: 1, name: 'Possible match' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Record decision' })).toHaveCount(0);
  });
});

test('shows the not found page and sends no assure request when assure is off', async ({
  page,
}) => {
  const sent = await stub(page, { modules: ['grants'] });
  await page.goto(`/northfield/assure/matches/${match}`);

  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  expect(sent.some(({ key }) => key.includes('screening') || key.includes('lookups'))).toBe(false);
});

const states = [
  {
    name: 'the registry panel',
    open: async (page: Page) => {
      await stub(page);
      await page.goto(`/northfield/assure/organisations/${organisation}`);
      await expect(page.getByText(/From the Charity Commission register/)).toBeVisible();
    },
  },
  {
    name: 'the matches queue',
    open: async (page: Page) => {
      await stub(page);
      await page.goto('/northfield/assure/matches');
      await expect(page.getByRole('table', { name: 'Possible matches' })).toBeVisible();
    },
  },
  {
    name: 'the match',
    open: async (page: Page) => {
      await stub(page);
      await page.goto(`/northfield/assure/matches/${match}`);
      await expect(page.getByText('Riverbank Lunch Society')).toBeVisible();
    },
  },
  {
    name: 'the decision dialog',
    open: async (page: Page) => {
      await stub(page);
      await page.goto(`/northfield/assure/matches/${match}`);
      await page.getByRole('button', { name: 'Record decision' }).click();
      await expect(page.getByRole('dialog', { name: 'Record decision' })).toBeVisible();
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
        await state.open(page);
        await expectNoViolations(page);
        await expectNoHorizontalScroll(page);
      });
    }
  });
}
