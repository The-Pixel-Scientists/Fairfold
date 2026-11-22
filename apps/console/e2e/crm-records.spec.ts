// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The crm record screens with the API stubbed and synthetic data only:
// search, organisation and person detail, merged and erased records, and
// crm switched off. The verify identifier and relationship sections wait for
// the crm record to carry identifier ids and relationship dates.

import { expect as strictExpect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { problem, stubSignedIn } from './auth-api.ts';
import type { Handler, SentRequest } from './auth-api.ts';
import { expectNoHorizontalScroll, expectNoViolations, variants } from './auth-axe.ts';

/** Each page loads its code when first opened, which a busy machine can slow past five seconds. */
const expect = strictExpect.configure({ timeout: 15_000 });

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const trust = uuid(1);
const sam = uuid(2);
const gone = uuid(3);
const missing = uuid(404);
const oldTrust = uuid(9);
const TERM = 'Riverside';

const reader = ['crm.records.read'];

const results = [
  {
    id: trust,
    kind: 'organisation',
    label: 'Riverside Trust',
    status: 'active',
    verification: 'verified',
  },
  {
    id: uuid(4),
    kind: 'organisation',
    label: 'Riverside Club',
    status: 'active',
    verification: 'claimed',
  },
  { id: sam, kind: 'person', label: 'Sam Patel', status: 'active', verification: 'none' },
];

const organisation = {
  state: 'current',
  status: 'active',
  organisation: {
    id: trust,
    name: 'Riverside Trust',
    legalForm: 'registered_charity',
    identifiers: [
      { scheme: 'GB-CHC', identifier: '1234567', verified: true },
      { scheme: 'GB-COH', identifier: '01234567', verified: false },
    ],
    registeredAddress: {
      line1: '1 Mill Lane',
      line2: null,
      town: 'Northfield',
      postcode: 'NF1 3QR',
      countryCode: 'GB',
    },
    website: null,
    contacts: [{ personId: sam, givenName: 'Sam', familyName: 'Patel', email: 'sam@example.org' }],
  },
  lists: [],
  externalReferences: [],
  timeline: { interactions: 1, latestAt: '2026-11-02T10:00:00.000Z' },
};

const person = {
  state: 'current',
  status: 'active',
  person: {
    id: sam,
    givenName: 'Sam',
    familyName: 'Patel',
    email: 'sam@example.org',
    phone: null,
    organisations: [{ id: trust, name: 'Riverside Trust' }],
    consents: [],
  },
  lists: [],
  externalReferences: [],
  timeline: { interactions: 0, latestAt: null },
};

const ok = (body: unknown): Handler => ({ status: 200, body });

const history = {
  entries: [
    {
      fieldId: 'organisation.name',
      previousValue: 'Riverside Club',
      newValue: 'Riverside Trust',
      changedAt: '2026-11-01T09:00:00.000Z',
      changedBy: uuid(5),
    },
  ],
  nextCursor: null,
};

const crmApi: Record<string, Handler> = {
  'POST /console/crm/search': ok({ results, nextCursor: null }),
  [`GET /console/crm/organisations/${trust}`]: ok(organisation),
  [`GET /console/crm/organisations/${oldTrust}`]: ok({ state: 'merged', survivorId: trust }),
  [`GET /console/crm/organisations/${missing}`]: problem(404, 'Not found.'),
  [`GET /console/crm/people/${sam}`]: ok(person),
  [`GET /console/crm/people/${gone}`]: ok({ state: 'erased' }),
  [`GET /console/crm/parties/${trust}/timeline`]: ok({
    interactions: [
      {
        id: uuid(10),
        kind: 'application_submitted',
        occurredAt: '2026-11-02T10:00:00.000Z',
        module: 'grants',
        source: { module: 'grants', entityType: 'grants.application', entityId: uuid(11) },
        summary: null,
        recordedBy: null,
      },
    ],
    nextCursor: null,
  }),
  [`GET /console/crm/parties/${sam}/timeline`]: ok({ interactions: [], nextCursor: null }),
  [`GET /console/organisations/${trust}/history`]: ok(history),
};

function stub(
  page: Page,
  options: { permissions?: string[]; modules?: string[] } = {},
): Promise<SentRequest[]> {
  const { permissions = reader, modules = ['grants', 'crm'] } = options;
  return stubSignedIn(page, { permissions, modules }, crmApi);
}

async function search(page: Page) {
  await page.goto('/northfield/crm');
  await page.getByRole('searchbox', { name: 'Search' }).fill(TERM);
  await page.getByRole('button', { name: 'Search records' }).click();
  await expect(page.getByRole('table', { name: 'Search results' })).toBeVisible();
}

test.describe('search', () => {
  test('finds an organisation and a person with the term in the body only', async ({ page }) => {
    const sent = await stub(page);
    await search(page);

    const table = page.getByRole('table', { name: 'Search results' });
    await expect(table.getByRole('link', { name: 'Riverside Trust' })).toBeVisible();
    await expect(table.getByRole('link', { name: 'Sam Patel' })).toBeVisible();
    await expect(table.getByText('Verified')).toBeVisible();
    await expect(table.getByText('Unverified')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: '3 results' })).toBeVisible();

    expect(sent.find(({ key }) => key === 'POST /console/crm/search')?.body).toEqual({
      term: TERM,
      limit: 25,
    });
    expect(page.url()).not.toContain(TERM);
    expect(
      JSON.stringify(await page.evaluate<unknown>(() => window.history.state as unknown)),
    ).not.toContain(TERM);
    expect(await page.title()).not.toContain(TERM);
  });

  test('puts the results back when you go back from a record', async ({ page }) => {
    await stub(page);
    await search(page);
    await page.getByRole('link', { name: 'Riverside Trust' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Riverside Trust' })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('table', { name: 'Search results' })).toBeVisible();
    await expect(page.getByRole('searchbox', { name: 'Search' })).toHaveValue(TERM);
  });
});

test.describe('organisation', () => {
  test('shows identifiers, contacts, value history and the timeline', async ({ page }) => {
    await stub(page, { permissions: [...reader, 'party.records.manage'] });
    await page.goto(`/northfield/crm/organisations/${trust}`);

    await expect(page.getByRole('heading', { level: 1, name: 'Riverside Trust' })).toBeVisible();
    const identifiers = page.getByRole('table', { name: 'Identifiers' });
    await expect(identifiers.getByText('Verified')).toBeVisible();
    await expect(identifiers.getByText('Unverified')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sam Patel' })).toHaveAttribute(
      'href',
      `/northfield/crm/people/${sam}`,
    );
    await expect(page.getByRole('table', { name: 'Changes to details' })).toContainText(
      'Riverside Club',
    );
    const timeline = page.getByRole('table', { name: 'Timeline' });
    await expect(timeline).toContainText('Application submitted');
    await expect(timeline.getByRole('link')).toHaveCount(0);
  });

  test('reads no value history for a member who cannot manage records', async ({ page }) => {
    const sent = await stub(page);
    await page.goto(`/northfield/crm/organisations/${trust}`);
    await expect(page.getByRole('table', { name: 'Timeline' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Changes to details' })).toHaveCount(0);
    expect(sent.some(({ key }) => key.endsWith('/history'))).toBe(false);
  });

  test('follows a merged id to the survivor and says so', async ({ page }) => {
    await stub(page);
    await page.goto(`/northfield/crm/organisations/${oldTrust}`);
    await expect(page.getByText('This record was merged')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/crm/organisations/${trust}$`));
  });

  test('shows the not found page for a record the member may not see', async ({ page }) => {
    await stub(page);
    await page.goto(`/northfield/crm/organisations/${missing}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  });
});

test.describe('person', () => {
  test('lists the organisations the person is a contact for', async ({ page }) => {
    await stub(page);
    await page.goto(`/northfield/crm/people/${sam}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Sam Patel' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Riverside Trust' })).toHaveAttribute(
      'href',
      `/northfield/crm/organisations/${trust}`,
    );
  });

  test('shows an erased person by their status only', async ({ page }) => {
    await stub(page);
    await page.goto(`/northfield/crm/people/${gone}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Erased person' })).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
  });
});

test('shows the not found page and sends no crm request when crm is off', async ({ page }) => {
  const sent = await stub(page, { modules: ['grants'] });
  await page.goto(`/northfield/crm/organisations/${trust}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  expect(sent.some(({ key }) => key.includes('/crm/'))).toBe(false);
});

const states = [
  {
    name: 'the search list with results',
    open: async (page: Page) => {
      await stub(page);
      await search(page);
    },
  },
  {
    name: 'the organisation page',
    open: async (page: Page) => {
      await stub(page, { permissions: [...reader, 'party.records.manage'] });
      await page.goto(`/northfield/crm/organisations/${trust}`);
      await expect(page.getByRole('table', { name: 'Timeline' })).toBeVisible();
    },
  },
  {
    name: 'the person page',
    open: async (page: Page) => {
      await stub(page);
      await page.goto(`/northfield/crm/people/${sam}`);
      await expect(page.getByText(/Nothing has happened with this record yet/)).toBeVisible();
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
