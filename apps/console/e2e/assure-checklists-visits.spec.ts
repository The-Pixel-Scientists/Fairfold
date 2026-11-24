// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The assure screens for due diligence with the API stubbed and synthetic
// data only: an application's advisory flags and checklist answers, the
// checklist list and editor, and monitoring visits at phone width. The names
// and numbers are invented.

import { expect as strictExpect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { problem, stubSignedIn } from './auth-api.ts';
import type { Handler, SentRequest } from './auth-api.ts';
import { expectNoHorizontalScroll, expectNoViolations, variants } from './auth-axe.ts';

/** Each page loads its code when first opened, which a busy machine can slow past five seconds. */
const expect = strictExpect.configure({ timeout: 15_000 });

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const checklist = uuid(1);
const application = uuid(2);
const organisation = uuid(3);
const person = uuid(4);
const visit = uuid(5);
const publishedAt = '2026-12-01T10:00:00.000Z';

const everything = [
  'assure.duplicates.review',
  'assure.checklists.manage',
  'assure.checklists.complete',
  'assure.visits.manage',
];

const ok = (body: unknown): Handler => ({ status: 200, body });

const item = (n: number, label: string, kind = 'yes_no') => ({
  id: uuid(n),
  label,
  help: '',
  kind,
  required: true,
});

const version = (number: number, id: number, items: unknown[]) => ({
  id: uuid(id),
  number,
  name: 'Governance checks',
  description: '',
  items,
  publishedAt,
});

const versionOne = version(1, 10, [
  item(20, 'Has a constitution'),
  item(21, 'Reviewed on', 'date'),
  item(22, 'Notes', 'short_text'),
]);

const flag = {
  id: uuid(30),
  partyId: uuid(31),
  otherPartyId: uuid(32),
  applicationId: application,
  otherApplicationId: null,
  signal: 'similar_name',
  raisedAt: '2026-12-01T10:00:00.000Z',
  dismissal: null,
};

const RESPONSE = `/console/applications/${application}/checklists/${checklist}`;
const response = {
  checklistId: checklist,
  applicationId: application,
  version: versionOne,
  answers: {},
  complete: false,
  savedAt: null,
};

const summary = {
  id: visit,
  organisationId: organisation,
  applicationId: null,
  visitedOn: '2026-11-30',
  type: 'in_person',
  openFollowUps: 2,
};

const search = {
  audience: 'staff',
  groups: [
    {
      module: 'crm',
      more: false,
      results: [
        { kind: 'crm.organisation', id: organisation, label: 'Riverside Lunch Club' },
        { kind: 'crm.person', id: person, label: 'Ada Example' },
      ],
    },
  ],
};

function stub(
  page: Page,
  options: { permissions?: string[]; modules?: string[]; more?: Record<string, Handler> } = {},
): Promise<SentRequest[]> {
  const { permissions = everything, modules = ['grants', 'assure'], more = {} } = options;
  return stubSignedIn(
    page,
    { permissions, modules },
    {
      [`GET /console/applications/${application}/duplicate-flags`]: ok({ flags: [flag] }),
      [`GET /console/applications/${application}/checklists`]: ok({
        checklists: [
          {
            checklistId: checklist,
            name: 'Governance checks',
            versionId: uuid(10),
            complete: false,
            savedAt: null,
          },
        ],
      }),
      [`GET ${RESPONSE}`]: ok(response),
      'GET /console/checklists': ok({
        checklists: [{ id: checklist, name: 'Governance checks', versionNumber: 1, publishedAt }],
      }),
      [`GET /console/checklists/${checklist}`]: ok({
        id: checklist,
        version: versionOne,
      }),
      'GET /console/visits': ok({ visits: [summary], nextCursor: null }),
      'POST /console/search': ok(search),
      ...more,
    },
  );
}

test.describe('flags', () => {
  test('shows each flag with its signal in words and offers no merge or block', async ({
    page,
  }) => {
    await stub(page);
    await page.goto(`/northfield/assure/applications/${application}`);

    await expect(page.getByText('Has a similar name to another record')).toBeVisible();
    await expect(page.getByText(/Nothing has been blocked or held/)).toBeVisible();
    await expect(page.getByRole('button', { name: /merge|verify|block/i })).toHaveCount(0);
  });
});

test.describe('checklists', () => {
  test('creates a checklist from items and sends no author or tenant', async ({ page }) => {
    const sent = await stub(page, {
      more: {
        'POST /console/checklists': {
          status: 201,
          body: { id: checklist, version: version(1, 10, [item(20, 'Has a constitution')]) },
        },
      },
    });
    await page.goto('/northfield/assure/checklists/new');

    await page.getByLabel('Name').fill('Governance checks');
    await page.getByRole('textbox', { name: 'Check' }).fill('Has a constitution');
    await page.getByRole('button', { name: 'Review and create' }).click();
    await page.getByRole('button', { name: 'Create checklist' }).click();

    await expect(page.getByText('Version 1 published')).toBeVisible();
    const post = sent.find(({ key }) => key === 'POST /console/checklists');
    expect(Object.keys(post?.body as object).sort()).toEqual(['description', 'items', 'name']);
    expect(JSON.stringify(post)).not.toMatch(/member|tenant|author/i);
  });

  test('publishes version 2 and a response still shows version 1', async ({ page }) => {
    const sent = await stub(page, {
      more: {
        [`POST /console/checklists/${checklist}/versions`]: {
          status: 201,
          body: {
            id: checklist,
            version: version(2, 11, [
              item(21, 'Reviewed on', 'date'),
              item(20, 'Has a constitution'),
            ]),
          },
        },
      },
    });
    await page.goto(`/northfield/assure/checklists/${checklist}`);

    await expect(page.getByText(/Version 1, published/)).toBeVisible();
    await page.getByRole('button', { name: 'Move item 1 down' }).click();
    await page.getByRole('button', { name: 'Review and publish' }).click();
    await expect(page.getByText('The order of the items changes.')).toBeVisible();
    await page.getByRole('button', { name: 'Publish new version' }).click();

    await expect(page.getByText('Version 2 published')).toBeVisible();
    expect(
      sent.filter(({ key }) => key.startsWith('POST') && key.endsWith('/versions')),
    ).toHaveLength(1);

    await page.goto(`/northfield/assure/applications/${application}`);
    await expect(page.getByText(/Answering version 1 of Governance checks/)).toBeVisible();
    await expect(page.getByText('Has a constitution')).toBeVisible();
  });

  test('offers to reload when a version was skipped', async ({ page }) => {
    await stub(page, {
      more: {
        [`POST /console/checklists/${checklist}/versions`]: problem(
          409,
          'Someone else published a new version. Reload the checklist and try again.',
        ),
      },
    });
    await page.goto(`/northfield/assure/checklists/${checklist}`);
    await page.getByLabel('Description').fill('Updated');
    await page.getByRole('button', { name: 'Review and publish' }).click();
    await page.getByRole('button', { name: 'Publish new version' }).click();

    await expect(page.getByText(/Someone else published a new version/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reload checklist' })).toBeVisible();
  });

  test('saves answers keyed by item id and links a server error to its field', async ({ page }) => {
    let tries = 0;
    const sent = await stub(page, {
      more: {
        [`PUT ${RESPONSE}`]: (body) => {
          tries += 1;
          if (tries === 1) {
            return problem(400, 'Check the answers and try again.', [
              { field: `body.answers.${uuid(22)}.value`, message: 'Shorten this answer.' },
            ]);
          }
          return {
            status: 200,
            body: { ...response, answers: (body as { answers: object }).answers, complete: true },
          };
        },
      },
    });
    await page.goto(`/northfield/assure/applications/${application}`);

    await page.getByLabel('Yes').check();
    await page.getByRole('button', { name: 'Save answers' }).click();
    await page.getByRole('link', { name: 'Shorten this answer.' }).click();
    await expect(page.getByLabel(/Notes/)).toBeFocused();

    await page.getByRole('button', { name: 'Save answers' }).click();
    await expect(page.getByText('Answers saved.')).toBeVisible();
    const puts = sent.filter(({ key }) => key.startsWith('PUT'));
    expect(puts.at(-1)?.body).toEqual({
      versionId: uuid(10),
      answers: { [uuid(20)]: { kind: 'yes_no', value: 'yes' } },
    });
    expect(JSON.stringify(puts)).not.toMatch(/member|tenant/i);
  });

  test('offers no editor to a member without the manage permission', async ({ page }) => {
    await stub(page, { permissions: ['assure.checklists.complete'] });
    await page.goto('/northfield/assure/checklists');

    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Create checklist' })).toHaveCount(0);
  });
});

test.describe('visits', () => {
  test.use({ viewport: { width: 320, height: 800 } });

  test('records a visit at 320px with an attendee and sends no member or tenant', async ({
    page,
  }) => {
    const sent = await stub(page, {
      more: {
        'POST /console/visits': {
          status: 201,
          body: {
            id: visit,
            organisationId: organisation,
            applicationId: null,
            visitedOn: summary.visitedOn,
            type: summary.type,
            attendeePersonIds: [person],
            findings: 'Records in order.',
            followUps: [],
            evidence: [],
            recordedAt: publishedAt,
            updatedAt: publishedAt,
          },
        },
      },
    });
    await page.goto('/northfield/assure/visits/new');

    await page.getByRole('combobox', { name: 'Organisation' }).fill('Riverside');
    await page.getByRole('option', { name: /Riverside Lunch Club/ }).click();
    await page.getByLabel('Day').fill('30');
    await page.getByLabel('Month').fill('11');
    await page.getByLabel('Year').fill('2026');
    await page.getByLabel('In person').check();
    await page.getByRole('combobox', { name: 'Add an attendee' }).fill('Ada');
    await page.getByRole('option', { name: /Ada Example/ }).click();
    await expect(page.getByRole('button', { name: 'Remove Ada Example' })).toBeVisible();
    await page.getByRole('textbox', { name: /Findings/ }).fill('Records in order.');
    await page.getByRole('button', { name: 'Record visit' }).dblclick();

    await expect(page.getByText('Visit recorded')).toBeVisible();
    await expectNoHorizontalScroll(page);
    const posts = sent.filter(({ key }) => key === 'POST /console/visits');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toMatchObject({
      organisationId: organisation,
      attendeePersonIds: [person],
      type: 'in_person',
    });
    expect(JSON.stringify(posts)).not.toMatch(/member|tenant|recorder/i);
  });

  test('keeps the form and links to the field when the type is missing', async ({ page }) => {
    await stub(page);
    await page.goto('/northfield/assure/visits/new');
    await page.getByRole('textbox', { name: /Findings/ }).fill('Records in order.');
    await page.getByRole('button', { name: 'Record visit' }).click();

    await expect(page.getByRole('link', { name: /Choose how the visit took place/ })).toBeVisible();
    await expect(page.getByRole('textbox', { name: /Findings/ })).toHaveValue('Records in order.');
  });
});

test('shows the not found page and sends no assure request when assure is off', async ({
  page,
}) => {
  const sent = await stub(page, { modules: ['grants'] });
  await page.goto(`/northfield/assure/applications/${application}`);

  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  expect(
    sent.some(({ key }) => key.includes('duplicate-flags') || key.includes('checklists')),
  ).toBe(false);
});

const states = [
  {
    name: 'the flags panel and response screen',
    open: async (page: Page) => {
      await stub(page);
      await page.goto(`/northfield/assure/applications/${application}`);
      await expect(page.getByText(/Answering version 1/)).toBeVisible();
    },
  },
  {
    name: 'the checklist list',
    open: async (page: Page) => {
      await stub(page);
      await page.goto('/northfield/assure/checklists');
      await expect(page.getByRole('table', { name: 'Due diligence checklists' })).toBeVisible();
    },
  },
  {
    name: 'the checklist editor',
    open: async (page: Page) => {
      await stub(page);
      await page.goto(`/northfield/assure/checklists/${checklist}`);
      await expect(page.getByText(/Version 1, published/)).toBeVisible();
    },
  },
  {
    name: 'the visit list',
    open: async (page: Page) => {
      await stub(page);
      await page.goto('/northfield/assure/visits');
      await expect(page.getByText('2 open follow-ups')).toBeVisible();
    },
  },
  {
    name: 'the visit form',
    open: async (page: Page) => {
      await stub(page);
      await page.goto('/northfield/assure/visits/new');
      await expect(page.getByRole('button', { name: 'Record visit' })).toBeVisible();
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
