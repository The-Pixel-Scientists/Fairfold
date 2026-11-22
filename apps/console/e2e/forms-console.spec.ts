// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The forms module's staff screens: build, preview and publish a form, start
// one from a feedback template, read responses and mark one as spam, and the
// not-found page when the tool is off. The API is stubbed (auth-api.ts) with
// synthetic data. The a11y specs check every page at three widths.

import type { Page } from '@playwright/test';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Handler } from './auth-api.ts';
import { problem, stubSignedIn } from './auth-api.ts';
import { expectNoHorizontalScroll, expectNoViolations, widths } from './auth-axe.ts';
import { addSection, firstQuestion, h1 } from './form-builder-steps.ts';

const formId = '00000000-0000-4000-8000-000000000001';
const templateId = '00000000-0000-4000-8000-000000000040';
const responseId = '00000000-0000-4000-8000-000000000007';
const versionId = '00000000-0000-4000-8000-000000000101';
const person = '00000000-0000-4000-8000-000000000055';

const permissions = [
  'forms.forms.manage',
  'forms.forms.publish',
  'forms.retention.manage',
  'forms.responses.read',
  'forms.responses.manage',
];

const definition = {
  sections: [
    {
      id: 's_about',
      title: 'About the session',
      fields: [
        {
          id: 'f_helped',
          type: 'yes_no',
          label: 'Did the session help?',
          classification: 'internal',
        },
        {
          id: 'f_comment',
          type: 'long_text',
          label: 'Anything else to tell us?',
          maxWords: 100,
          classification: 'personal',
        },
      ],
    },
  ],
};

const form = {
  id: formId,
  title: 'Drop-in feedback',
  description: '',
  respondents: 'signed_in',
  opensAt: null,
  closesAt: null,
  retentionMonths: 12,
  confirmationMessage: '',
  status: 'draft',
  latestVersion: null,
  createdAt: '2027-01-04T09:00:00Z',
  updatedAt: '2027-01-04T09:00:00Z',
};

const summary = (over: object = {}) => ({
  id: formId,
  title: form.title,
  respondents: form.respondents,
  opensAt: null,
  closesAt: null,
  status: 'draft',
  latestVersion: null,
  updatedAt: form.updatedAt,
  ...over,
});

const publishedVersion = (n: number, body: unknown = definition) => ({
  id: versionId,
  formId,
  version: n,
  respondents: 'signed_in',
  publishedAt: '2027-01-05T09:00:00Z',
  definition: body,
});

const responseSummary = (over: object = {}) => ({
  id: responseId,
  formId,
  formVersionId: versionId,
  version: 1,
  route: 'signed_in',
  personId: person,
  submittedAt: '2027-03-02T10:00:00Z',
  sentWithoutCheck: false,
  spamReason: null,
  ...over,
});

const ok = (body: unknown) => ({ status: 200, body });

/** The reads of a form that exists with a saved draft and no published version. */
const existing: Record<string, Handler> = {
  [`GET /console/forms/${formId}`]: ok(form),
  [`GET /console/forms/${formId}/draft`]: ok({
    formId,
    definition,
    updatedAt: '2027-01-04T10:00:00Z',
  }),
  [`GET /console/forms/${formId}/versions`]: ok({ versions: [] }),
  [`GET /console/forms/${formId}/preview`]: ok({
    definition,
    visibleFieldIds: ['f_helped', 'f_comment'],
  }),
  [`GET /console/forms/${formId}/response-totals`]: ok({
    received: 12,
    signedIn: 9,
    anonymous: 3,
    sentWithoutCheck: 1,
    spam: 2,
  }),
  [`GET /console/forms/${formId}/responses`]: ok({
    responses: [responseSummary(), responseSummary({ route: 'anonymous', personId: null })].map(
      (item, index) => ({ ...item, id: `00000000-0000-4000-8000-00000000000${String(7 + index)}` }),
    ),
    nextCursor: null,
  }),
  [`GET /console/form-responses/${responseId}`]: ok({
    ...responseSummary(),
    definition,
    answers: { f_helped: true, f_comment: 'The volunteers were kind.' },
  }),
  'GET /console/forms': ok({ forms: [summary()], nextCursor: null }),
  'GET /console/feedback-templates': ok({
    templates: [
      {
        id: templateId,
        version: 1,
        title: 'Feedback on a service',
        description: 'Ask people what they thought of a service you run or fund.',
        questions: 2,
      },
    ],
  }),
  [`GET /console/feedback-templates/${templateId}`]: ok({
    id: templateId,
    version: 1,
    title: 'Feedback on a service',
    description: 'Ask people what they thought of a service you run or fund.',
    definition,
  }),
};

async function open(
  page: Page,
  path: string,
  more: Record<string, Handler> = {},
  modules = ['grants', 'forms'],
) {
  const sent = await stubSignedIn(page, { permissions, modules }, { ...existing, ...more });
  await page.goto(`/northfield${path}`);
  return sent;
}

test.describe('forms: build, preview and publish', () => {
  test('creates a form, adds a question, saves, previews and publishes version 1', async ({
    page,
  }) => {
    let saved: unknown = null;
    let published = false;
    const sent = await open(page, '/forms/new', {
      'POST /console/forms': { status: 201, body: form },
      [`GET /console/forms/${formId}`]: () =>
        ok(published ? { ...form, status: 'published', latestVersion: 1 } : form),
      [`GET /console/forms/${formId}/draft`]: () =>
        ok({ formId, definition: saved, updatedAt: '2027-01-04T10:00:00Z' }),
      [`PUT /console/forms/${formId}/draft`]: (body) => {
        saved = (body as { definition: unknown }).definition;
        return ok({ formId, definition: saved, updatedAt: '2027-01-04T14:02:00Z' });
      },
      [`GET /console/forms/${formId}/preview`]: () =>
        ok({ definition: saved, visibleFieldIds: [] }),
      [`POST /console/forms/${formId}/versions`]: () => {
        published = true;
        return { status: 201, body: publishedVersion(1, saved) };
      },
    });

    await expect(h1(page, 'Create form')).toBeVisible();
    await page.getByRole('textbox', { name: 'Form title' }).fill('Drop-in feedback');
    await page.getByRole('button', { name: 'Create form' }).click();
    await expect(h1(page, 'Drop-in feedback')).toBeVisible();
    expect(sent.filter(({ key }) => key === 'POST /console/forms')).toHaveLength(1);

    await addSection(page, 'About the session');
    await firstQuestion(page, 'Did the session help?');
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByText(/^Saved at /)).toBeVisible();

    await page.getByRole('tab', { name: 'Preview' }).click();
    await expect(page.getByText('Preview only. Answers are not saved.')).toBeVisible();

    await page.getByRole('button', { name: 'Publish form' }).click();
    const dialog = page.getByRole('dialog', { name: 'Publish version 1?' });
    await expect(dialog.getByText(/cannot be changed/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Publish form' }).click();
    await expect(page.getByText('Version 1 is published.')).toBeAttached();
    await expect(
      page.getByText(/Version 1 is published\. Publishing again makes version 2/),
    ).toBeVisible();
  });

  test('shows a publish refusal in the server words beside the named question', async ({
    page,
  }) => {
    const refusal =
      'This question had another type when it was published. Change it back, or add a new question instead.';
    await open(page, `/forms/${formId}`, {
      [`POST /console/forms/${formId}/versions`]: problem(422, 'This form cannot be published.', [
        { field: 'f_helped', message: refusal },
      ]),
    });

    await page.getByRole('button', { name: 'Publish form' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Publish form' }).click();
    await expect(dialog.getByText(`Section 1, question 1: ${refusal}`)).toBeVisible();
    await dialog.getByRole('button', { name: 'Keep editing' }).click();

    await expect(
      page.getByRole('alert').getByRole('link', { name: /Section 1, question 1/ }),
    ).toBeVisible();
    await expect(page.getByText(refusal, { exact: true })).toBeVisible();
  });

  test('starts from a feedback template and opens the new draft', async ({ page }) => {
    const sent = await open(page, '/forms/templates', {
      [`POST /console/feedback-templates/${templateId}/forms`]: { status: 201, body: form },
    });

    await page.getByRole('link', { name: /^Preview template/ }).click();
    await expect(h1(page, 'Feedback on a service')).toBeVisible();
    await expect(page.getByText('Did the session help?')).toBeVisible();
    await page.getByRole('button', { name: 'Use this template' }).click();

    await expect(h1(page, 'Drop-in feedback')).toBeVisible();
    expect(sent.filter(({ key }) => key.startsWith('POST') && key.endsWith('/forms'))).toHaveLength(
      1,
    );
  });
});

test.describe('forms: responses', () => {
  test('lists responses, reads one and marks it as spam with a reason', async ({ page }) => {
    const sent = await open(page, `/forms/${formId}/responses`, {
      [`POST /console/form-responses/${responseId}/spam`]: ok(
        responseSummary({ spamReason: 'duplicate' }),
      ),
    });

    await expect(h1(page, 'Responses')).toBeVisible();
    await expect(page.getByRole('table', { name: /response totals/i })).toBeVisible();
    await page.getByRole('link', { name: '2 March 2027 at 10am' }).first().click();
    await expect(h1(page, 'Response')).toBeVisible();
    await expect(page.getByText('The volunteers were kind.')).toBeVisible();

    await page.getByRole('button', { name: 'Mark as spam' }).click();
    const dialog = page.getByRole('dialog', { name: 'Mark this response as spam?' });
    await expect(dialog.getByText(/The response is kept/)).toBeVisible();
    await dialog.getByRole('radio', { name: 'A duplicate' }).check();
    await dialog.getByRole('button', { name: 'Mark as spam' }).click();

    await expect(page.getByText('Spam: A duplicate')).toBeVisible();
    expect(sent.find(({ key }) => key.endsWith('/spam'))?.body).toEqual({ reason: 'duplicate' });
    await expect(page.getByRole('button', { name: /delete/i })).toHaveCount(0);
    expect(page.url()).not.toContain('kind');
    expect(await page.evaluate(() => JSON.stringify(history.state))).not.toContain('kind');
  });
});

test.describe('forms: access', () => {
  test('shows the not-found page when forms is off, with no forms screen', async ({ page }) => {
    await open(page, '/forms', {}, ['grants']);
    await expect(h1(page, 'Page not found')).toBeVisible();

    await page.goto(`/northfield/forms/${formId}`);
    await expect(h1(page, 'Page not found')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Publish form' })).toHaveCount(0);
  });

  test('shows the same not-found page for a form in another funder', async ({ page }) => {
    await open(page, `/forms/${formId}`, {
      [`GET /console/forms/${formId}`]: problem(404, 'We could not find that.'),
    });
    await expect(h1(page, 'Page not found')).toBeVisible();
  });
});

const pages: { name: string; path: string; heading: string }[] = [
  { name: 'the form list', path: '/forms', heading: 'Forms' },
  { name: 'create form', path: '/forms/new', heading: 'Create form' },
  { name: 'the builder', path: `/forms/${formId}`, heading: 'Drop-in feedback' },
  { name: 'form settings', path: `/forms/${formId}/settings`, heading: 'Form settings' },
  { name: 'responses', path: `/forms/${formId}/responses`, heading: 'Responses' },
  { name: 'one response', path: `/forms/${formId}/responses/${responseId}`, heading: 'Response' },
  { name: 'the template gallery', path: '/forms/templates', heading: 'Start from a template' },
  {
    name: 'one template',
    path: `/forms/templates/${templateId}`,
    heading: 'Feedback on a service',
  },
];

for (const { name, path, heading } of pages) {
  test(`@a11y ${name} has no axe violations and fits at 320 px and 200% zoom`, async ({ page }) => {
    await open(page, path);
    for (const { viewport } of widths) {
      await page.setViewportSize(viewport);
      await page.goto(`/northfield${path}`);
      await expect(h1(page, heading)).toBeVisible();
      await expectNoViolations(page);
      await expectNoHorizontalScroll(page);
    }
  });
}
