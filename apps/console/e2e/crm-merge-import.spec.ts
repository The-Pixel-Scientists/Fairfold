// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The crm duplicate, merge, list, segment and import screens with the API
// stubbed and synthetic data only. The wizard's upload and column mapping
// wait for the upload route; these journeys start at an import's page.

import { expect as strictExpect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { consoleSession, problem, stubSignedIn } from './auth-api.ts';
import type { Handler, SentRequest } from './auth-api.ts';
import { expectNoHorizontalScroll, expectNoViolations, variants } from './auth-axe.ts';

/** Each page loads its code when first opened, which a busy machine can slow past five seconds. */
const expect = strictExpect.configure({ timeout: 15_000 });

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const trust = uuid(1);
const club = uuid(2);
const list = uuid(10);
const segment = uuid(20);
const job = uuid(30);
const SEARCH_TERM = 'Riverside';
const TOKEN = `1700000000.${'a'.repeat(43)}`;
const STEP_UP_NEEDED = 'Confirm it is you again, then try again.';

const reviewer = ['crm.records.read', 'crm.duplicates.review', 'crm.parties.merge'];
const everything = [...reviewer, 'crm.lists.manage', 'crm.segments.manage', 'crm.imports.run'];

const ok = (body: unknown): Handler => ({ status: 200, body });

const organisation = (id: string, name: string) =>
  ok({
    state: 'current',
    status: 'active',
    organisation: {
      id,
      name,
      legalForm: 'registered_charity',
      identifiers: [],
      registeredAddress: {
        line1: '1 Mill Lane',
        line2: null,
        town: 'Northfield',
        postcode: 'NF1 3QR',
        countryCode: 'GB',
      },
      website: null,
      contacts: [],
    },
    lists: [],
    externalReferences: [],
    timeline: { interactions: 0, latestAt: null },
  });

const pair = {
  partyId: trust,
  otherPartyId: club,
  kind: 'organisation',
  signals: ['verified_identifier', 'name'],
  band: 'high',
};

const preview = {
  loserId: club,
  survivorId: trust,
  kind: 'organisation',
  fields: [
    { fieldId: 'organisation.name', loser: 'Riverside Club', survivor: 'Riverside Trust' },
    { fieldId: 'organisation.website', loser: null, survivor: null },
  ],
  conflicts: [],
  counts: { grants: { 'grants.application': 3 }, crm: { 'crm.list_member': 2 } },
  linkRule: 'automatic',
  links: [],
  token: TOKEN,
};

const merge = {
  id: uuid(50),
  kind: 'merge',
  partyKind: 'organisation',
  loserId: club,
  survivorId: trust,
  reverses: null,
  decidedAt: '2026-11-19T10:00:00.000Z',
  decidedBy: uuid(60),
  counts: preview.counts,
};

const theList = {
  id: list,
  name: 'Cohort 2026',
  description: null,
  members: 1,
  archivedAt: null,
  updatedAt: '2026-11-01T10:00:00.000Z',
};

const theSegment = {
  id: segment,
  name: 'Charities',
  description: null,
  filters: {
    '00000000-0000-4000-8000-000000000001': {
      field: 'legal_form',
      operator: 'eq',
      value: 'registered_charity',
    },
  },
  version: 1,
  archivedAt: null,
  updatedAt: '2026-11-19T10:00:00.000Z',
};

const importJob = {
  id: job,
  target: 'organisation',
  state: 'ready',
  failure: null,
  rows: { total: 6, valid: 3, withErrors: 1, duplicates: 2 },
  result: null,
  createdAt: '2026-11-19T10:00:00.000Z',
  completedAt: null,
};

const importRows = {
  rows: [
    { row: 2, status: 'valid', values: { name: 'Riverside Trust' }, errors: [], duplicates: [] },
    {
      row: 14,
      status: 'error',
      values: { identifier: 'ZZ-NOT-A-NUMBER' },
      errors: [{ field: 'identifier', code: 'not_valid' }],
      duplicates: [],
    },
  ],
  nextCursor: null,
};

const readNames: Record<string, Handler> = {
  [`GET /console/crm/organisations/${trust}`]: organisation(trust, 'Riverside Trust'),
  [`GET /console/crm/organisations/${club}`]: organisation(club, 'Riverside Club'),
};

/** Answers a step-up with the same session, and records each request to the merge route. */
function stepUp(permissions: string[]): Record<string, Handler> {
  return {
    'POST /auth/step-up': ok({
      ...consoleSession({ permissions, modules: ['grants', 'crm'] }),
      recentAuthUntil: new Date(Date.now() + 300_000).toISOString(),
    }),
  };
}

function stub(
  page: Page,
  more: Record<string, Handler> = {},
  options: { permissions?: string[]; modules?: string[] } = {},
): Promise<SentRequest[]> {
  const { permissions = everything, modules = ['grants', 'crm'] } = options;
  return stubSignedIn(page, { permissions, modules }, { ...readNames, ...more });
}

async function confirmItsYou(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Confirm it is you' });
  await dialog.getByLabel('Password').fill('correct horse battery');
  await dialog.getByLabel('Code from your authenticator app').fill('123456');
  await dialog.getByRole('button', { name: 'Confirm it is you' }).click();
}

const duplicatesApi: Record<string, Handler> = {
  'POST /console/crm/duplicates/query': ok({ pairs: [pair], nextCursor: null }),
};

test.describe('duplicates', () => {
  test('lists pairs in words and dismisses one with a reason', async ({ page }) => {
    const sent = await stub(page, {
      ...duplicatesApi,
      'POST /console/crm/duplicate-dismissals': {
        status: 201,
        body: {
          id: uuid(70),
          partyId: trust,
          otherPartyId: club,
          reason: 'different_organisation',
          dismissedAt: '2026-11-19T10:00:00.000Z',
        },
      },
    });
    await page.goto('/northfield/crm/duplicates');

    await expect(
      page.getByRole('heading', { level: 1, name: 'Possible duplicates' }),
    ).toBeVisible();
    await expect(page.getByText('Same verified number, Similar name')).toBeVisible();
    await page.getByRole('button', { name: 'Not a duplicate' }).click();
    const dialog = page.getByRole('dialog', { name: 'Mark as not duplicates' });
    await dialog.getByRole('radio', { name: 'They are different organisations' }).check();
    await dialog.getByRole('button', { name: 'Mark as not duplicates' }).click();

    await expect(page.getByText('No possible duplicates')).toBeVisible();
    expect(sent.find(({ key }) => key.endsWith('duplicate-dismissals'))?.body).toEqual({
      partyId: trust,
      otherPartyId: club,
      reason: 'different_organisation',
    });
  });

  test('compares two records and merges them behind step-up, naming what moves', async ({
    page,
  }) => {
    let confirms = 0;
    const sent = await stub(page, {
      ...stepUp(everything),
      'POST /console/crm/merges/preview': ok(preview),
      'POST /console/crm/merges': () => {
        confirms += 1;
        return confirms === 1 ? problem(403, STEP_UP_NEEDED) : { status: 201, body: merge };
      },
    });
    await page.goto(`/northfield/crm/duplicates/organisation/${trust}/${club}`);

    await expect(page.getByRole('heading', { level: 1, name: 'Compare records' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Different' })).toBeVisible();
    await page.getByRole('button', { name: 'Review merge of organisations' }).click();
    const dialog = page.getByRole('dialog', { name: 'Merge organisations' });
    await expect(dialog).toContainText(
      '3 applications and 2 list memberships will move to Riverside Trust. Riverside Club will be marked as merged.',
    );
    await dialog.getByRole('button', { name: 'Merge organisations' }).click();
    await confirmItsYou(page);

    await expect(page.getByText('The records are merged')).toBeVisible();
    await expect(page.getByText(new RegExp(merge.id))).toBeVisible();
    const posts = sent.filter(({ key }) => key === 'POST /console/crm/merges');
    expect(posts).toHaveLength(2);
    expect(posts[0]?.body).toEqual({
      loserId: club,
      survivorId: trust,
      kind: 'organisation',
      carryOver: [],
      token: TOKEN,
    });
    expect(JSON.stringify(posts[0]?.body)).not.toMatch(/tenant|member|actor/i);
  });

  test('refuses a stale preview, says to compare again and reads the preview again', async ({
    page,
  }) => {
    const sent = await stub(page, {
      'POST /console/crm/merges/preview': ok(preview),
      'POST /console/crm/merges': problem(409, 'Preview the merge again, then confirm it.'),
    });
    await page.goto(`/northfield/crm/duplicates/organisation/${trust}/${club}`);

    const previews = () =>
      sent.filter(({ key }) => key === 'POST /console/crm/merges/preview').length;

    await page.getByRole('button', { name: 'Review merge of organisations' }).click();
    const confirm = page
      .getByRole('dialog', { name: 'Merge organisations' })
      .getByRole('button', { name: 'Merge organisations' });
    await expect(confirm).toBeVisible();
    // Counted from here: the development server runs each effect twice, so the first read may be sent twice.
    const before = previews();
    await confirm.click();

    await expect(page.getByText(/Compare the records again, then merge/)).toBeVisible();
    await expect.poll(previews).toBe(before + 1);
  });

  test('blocks a merge the server cannot do and says how to resolve it', async ({ page }) => {
    await stub(page, {
      'POST /console/crm/merges/preview': ok({
        ...preview,
        conflicts: ['identifiers_both_verified'],
      }),
    });
    await page.goto(`/northfield/crm/duplicates/organisation/${trust}/${club}`);

    await expect(page.getByText('These records cannot be merged yet')).toBeVisible();
    await expect(page.getByText(/keep them as separate records/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Review merge/ })).toHaveCount(0);
  });

  test('shows no duplicates or merge action to a member without the permissions', async ({
    page,
  }) => {
    const sent = await stub(page, duplicatesApi, { permissions: ['crm.records.read'] });
    await page.goto('/northfield/crm/duplicates');
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    await page.goto(`/northfield/crm/duplicates/organisation/${trust}/${club}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    expect(sent.some(({ key }) => key.includes('duplicates') || key.includes('merges'))).toBe(
      false,
    );
  });
});

test.describe('lists and segments', () => {
  const listApi: Record<string, Handler> = {
    'GET /console/crm/lists': ok({ lists: [theList], nextCursor: null }),
    [`GET /console/crm/lists/${list}/members`]: ok({
      members: [{ partyId: trust, kind: 'organisation', addedAt: '2026-11-01T10:00:00.000Z' }],
      nextCursor: null,
    }),
  };

  test('creates a list, then adds and removes members', async ({ page }) => {
    const sent = await stub(page, {
      ...listApi,
      'POST /console/crm/lists': { status: 201, body: theList },
      'POST /console/crm/search': ok({
        results: [
          {
            id: club,
            kind: 'organisation',
            label: 'Riverside Club',
            status: 'active',
            verification: 'none',
          },
        ],
        nextCursor: null,
      }),
      [`POST /console/crm/lists/${list}/members`]: ok({ changed: 1, unchanged: 0 }),
      [`POST /console/crm/lists/${list}/members/removal`]: ok({ changed: 1, unchanged: 0 }),
    });
    await page.goto('/northfield/crm/lists');

    await expect(page.getByText(/Nothing is sent to a list/).first()).toBeVisible();
    await page.getByRole('button', { name: 'Create list' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create list' });
    await dialog.getByLabel('Name').fill('Cohort 2026');
    await dialog.getByRole('button', { name: 'Create list' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.getByRole('link', { name: 'Cohort 2026' }).click();
    await page.getByRole('searchbox', { name: 'Search' }).fill(SEARCH_TERM);
    await page.getByRole('button', { name: 'Search records' }).click();
    await page.getByRole('checkbox', { name: 'Select Riverside Club' }).check();
    await page.getByRole('button', { name: 'Add 1 to list' }).click();
    await expect(page.getByText('Added 1 to the list.')).toBeVisible();
    await page.getByRole('button', { name: 'Remove from list' }).click();

    expect(sent.find(({ key }) => key === 'POST /console/crm/lists')?.body).toEqual({
      name: 'Cohort 2026',
    });
    expect(sent.find(({ key }) => key === 'POST /console/crm/search')?.body).toMatchObject({
      term: SEARCH_TERM,
    });
    expect(page.url()).not.toContain(SEARCH_TERM);
  });

  test('saves a segment without its filters reaching the address or history', async ({ page }) => {
    const sent = await stub(page, {
      'GET /console/crm/segments': ok({ segments: [], nextCursor: null }),
      'GET /console/crm/lists': ok({ lists: [theList], nextCursor: null }),
      'POST /console/crm/segments': { status: 201, body: theSegment },
      [`GET /console/crm/segments/${segment}`]: ok(theSegment),
      [`GET /console/crm/segments/${segment}/members`]: ok({ members: [], nextCursor: null }),
    });
    await page.goto('/northfield/crm/segments');

    await page.getByLabel('Name', { exact: true }).fill('Charities');
    await page.getByLabel('Field 1').selectOption('legal_form');
    await page.getByLabel('Value 1').selectOption('registered_charity');
    await expect(page.getByText(/as a new version/)).toBeVisible();
    await page.getByRole('button', { name: 'Save segment' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Charities' })).toBeVisible();
    await expect(page.getByText('Legal form is Registered charity')).toBeVisible();
    expect(page.url()).not.toContain('registered_charity');
    expect(JSON.stringify(await page.evaluate((): unknown => window.history.state))).not.toContain(
      'registered_charity',
    );
    const body = sent.find(({ key }) => key === 'POST /console/crm/segments')?.body as {
      filters: Record<string, unknown>;
    };
    expect(Object.values(body.filters)).toEqual([
      { field: 'legal_form', operator: 'eq', value: 'registered_charity' },
    ]);
    await expect(page.getByRole('button', { name: /send|export/i })).toHaveCount(0);
  });
});

test.describe('import', () => {
  const importApi: Record<string, Handler> = {
    [`GET /console/crm/imports/${job}`]: ok(importJob),
    [`GET /console/crm/imports/${job}/rows`]: ok(importRows),
  };

  test('names the row and field of each error, then imports behind step-up', async ({ page }) => {
    let confirms = 0;
    const sent = await stub(page, {
      ...importApi,
      ...stepUp(everything),
      [`POST /console/crm/imports/${job}/confirmation`]: () => {
        confirms += 1;
        return confirms === 1
          ? problem(403, STEP_UP_NEEDED)
          : { status: 200, body: { created: 3, skippedErrors: 1, skippedDuplicates: 2 } };
      },
    });
    await page.goto(`/northfield/crm/imports/${job}`);

    await expect(
      page.getByText(
        'Row 14, identifier: Correct this value in the file so it is in the expected format.',
      ),
    ).toBeVisible();
    await expect(page.getByText('ZZ-NOT-A-NUMBER')).toHaveCount(0);
    await expect(page.getByText(/Skip 1 row with errors/)).toBeVisible();
    await expect(
      page.getByText(/does not verify numbers, merge records or send anything/),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Import 3 organisations' }).click();
    await confirmItsYou(page);

    await expect(page.getByText('Imported 3 organisations')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open records' })).toBeVisible();
    const posts = sent.filter(({ key }) => key.endsWith('/confirmation'));
    expect(posts).toHaveLength(2);
    expect(posts[0]?.body).toEqual({ duplicates: 'skip' });
  });

  test('says why a file could not be used', async ({ page }) => {
    await stub(page, {
      [`GET /console/crm/imports/${job}`]: ok({
        ...importJob,
        state: 'failed',
        failure: 'too_large',
      }),
    });
    await page.goto(`/northfield/crm/imports/${job}`);
    await expect(
      page.getByText(
        'The file is larger than 5 MB. Split it into smaller files and upload each one.',
      ),
    ).toBeVisible();
  });

  test('shows the not found page without a request to a member who may not import', async ({
    page,
  }) => {
    const sent = await stub(page, importApi, { permissions: reviewer });
    await page.goto(`/northfield/crm/imports/${job}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    expect(sent.some(({ key }) => key.includes('/imports/'))).toBe(false);
  });
});

test('shows the not found page and sends no crm request when crm is off', async ({ page }) => {
  const sent = await stub(page, duplicatesApi, { modules: ['grants'] });
  for (const path of ['duplicates', 'lists', 'segments', `imports/${job}`]) {
    await page.goto(`/northfield/crm/${path}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  }
  expect(sent.some(({ key }) => key.includes('/crm/'))).toBe(false);
});

const states = [
  {
    name: 'the duplicates list',
    open: async (page: Page) => {
      await stub(page, duplicatesApi);
      await page.goto('/northfield/crm/duplicates');
      await expect(page.getByText('Same verified number, Similar name')).toBeVisible();
    },
  },
  {
    name: 'the compare page',
    open: async (page: Page) => {
      await stub(page, { 'POST /console/crm/merges/preview': ok(preview) });
      await page.goto(`/northfield/crm/duplicates/organisation/${trust}/${club}`);
      await expect(page.getByRole('cell', { name: 'Different' })).toBeVisible();
    },
  },
  {
    name: 'the open merge dialog',
    open: async (page: Page) => {
      await stub(page, { 'POST /console/crm/merges/preview': ok(preview) });
      await page.goto(`/northfield/crm/duplicates/organisation/${trust}/${club}`);
      await page.getByRole('button', { name: 'Review merge of organisations' }).click();
      await expect(page.getByRole('dialog', { name: 'Merge organisations' })).toBeVisible();
    },
  },
  {
    name: 'the lists',
    open: async (page: Page) => {
      await stub(page, { 'GET /console/crm/lists': ok({ lists: [theList], nextCursor: null }) });
      await page.goto('/northfield/crm/lists');
      await expect(page.getByRole('link', { name: 'Cohort 2026' })).toBeVisible();
    },
  },
  {
    name: 'the segment builder',
    open: async (page: Page) => {
      await stub(page, {
        'GET /console/crm/segments': ok({ segments: [], nextCursor: null }),
        'GET /console/crm/lists': ok({ lists: [theList], nextCursor: null }),
      });
      await page.goto('/northfield/crm/segments');
      await expect(page.getByRole('button', { name: 'Save segment' })).toBeVisible();
    },
  },
  {
    name: 'the import preview',
    open: async (page: Page) => {
      await stub(page, {
        [`GET /console/crm/imports/${job}`]: ok(importJob),
        [`GET /console/crm/imports/${job}/rows`]: ok(importRows),
      });
      await page.goto(`/northfield/crm/imports/${job}`);
      await expect(page.getByRole('button', { name: 'Import 3 organisations' })).toBeVisible();
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
