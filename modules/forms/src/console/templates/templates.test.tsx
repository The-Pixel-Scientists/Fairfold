// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { definition, draft, form, formId } from '../fixtures.test.ts';
import { id, ok, openForms, problem, setUpFormsTests, stubApi } from '../harness.test.tsx';

setUpFormsTests();

const templateId = id(40);

const summary = {
  id: templateId,
  version: 1,
  title: 'Feedback on a service',
  description: 'Ask people what they thought of a service you run or fund.',
  questions: 4,
};

describe('the template gallery', () => {
  it('lists each template with its purpose and number of questions, and a way to preview it', async () => {
    stubApi({ 'GET /console/feedback-templates': ok({ templates: [summary] }) });
    openForms('/forms/templates');

    const card = (await screen.findByRole('heading', { name: 'Feedback on a service' })).closest(
      'li',
    ) as HTMLElement;
    expect(within(card).getByText(summary.description)).toBeTruthy();
    expect(within(card).getByText('4 questions')).toBeTruthy();
    expect(within(card).getByRole('link', { name: /Preview template/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /edit|delete/i })).toBeNull();
  });
});

describe('one template', () => {
  const key = `GET /console/feedback-templates/${templateId}`;
  const detail = {
    id: templateId,
    version: 1,
    title: summary.title,
    description: summary.description,
    definition,
  };

  it('previews the template read only, saying nothing is saved', async () => {
    stubApi({ [key]: ok(detail) });
    openForms(`/forms/templates/${templateId}`);

    expect(await screen.findByRole('heading', { level: 1, name: summary.title })).toBeTruthy();
    expect(screen.getByText(/Preview only\. Answers are not saved\./)).toBeTruthy();
    expect(await screen.findByText('Did the session help?')).toBeTruthy();
  });

  it('creates one form from the template, with a key, and opens its draft', async () => {
    const user = userEvent.setup();
    const sent = stubApi({
      [key]: ok(detail),
      [`POST /console/feedback-templates/${templateId}/forms`]: { status: 201, body: form },
      [`GET /console/forms/${formId}`]: ok(form),
      [`GET /console/forms/${formId}/draft`]: ok(draft),
      [`GET /console/forms/${formId}/versions`]: ok({ versions: [] }),
    });
    openForms(`/forms/templates/${templateId}`);

    expect(await screen.findByLabelText<HTMLInputElement>('Form title')).toHaveProperty(
      'value',
      summary.title,
    );
    await user.click(screen.getByRole('button', { name: 'Use this template' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Drop-in feedback' })).toBeTruthy();
    const creates = sent.filter(
      ({ key: sentKey }) => sentKey.endsWith('/forms') && sentKey.startsWith('POST'),
    );
    expect(creates).toHaveLength(1);
    expect(creates[0]?.idempotencyKey).toBeTruthy();
    expect(creates[0]?.body).toMatchObject({ title: summary.title });
  });

  it('shows the not-found page for a template that is not there', async () => {
    stubApi({ [key]: problem(404, 'We could not find that.') });
    openForms(`/forms/templates/${templateId}`);

    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy();
  });
});
