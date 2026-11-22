// SPDX-License-Identifier: AGPL-3.0-or-later

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { form, formId, summaryOf } from '../fixtures.test.ts';
import { id, ok, openForms, problem, setUpFormsTests, stubApi } from '../harness.test.tsx';

setUpFormsTests();

const published = summaryOf({
  id: id(2),
  title: 'Spring survey',
  status: 'published',
  respondents: 'anonymous',
  opensAt: '2027-07-01T08:00:00Z',
  closesAt: '2027-07-31T22:30:00Z',
  latestVersion: 3,
});

describe('the form list', () => {
  it('lists forms with status in words and times in UK time', async () => {
    stubApi({
      'GET /console/forms': ok({ forms: [summaryOf(), published], nextCursor: null }),
    });
    openForms('/forms');

    const table = await screen.findByRole('table', { name: /forms/i });
    const row = within(table)
      .getByRole('link', { name: 'Spring survey' })
      .closest('tr') as HTMLElement;
    expect(within(row).getByText('Published')).toBeTruthy();
    expect(within(row).getByText('Anyone')).toBeTruthy();
    expect(within(row).getByText('1 July 2027 at 9am')).toBeTruthy();
    expect(within(row).getByText('31 July 2027 at 11:30pm')).toBeTruthy();
    expect(within(row).getByText('3')).toBeTruthy();
    expect(within(table).getByText('Draft')).toBeTruthy();
  });

  it('filters by status and shows the next page when asked', async () => {
    const user = userEvent.setup();
    const sent = stubApi({
      'GET /console/forms': ok({ forms: [summaryOf()], nextCursor: 'page2' }),
      'GET /console/forms?cursor=page2': ok({ forms: [published], nextCursor: null }),
      'GET /console/forms?status=published': ok({ forms: [published], nextCursor: null }),
    });
    openForms('/forms');

    await user.click(await screen.findByRole('button', { name: 'Show more forms' }));
    expect(await screen.findByRole('link', { name: 'Spring survey' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show more forms' })).toBeNull();

    await user.selectOptions(screen.getByLabelText('Show'), 'published');
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: 'Drop-in feedback' })).toBeNull();
    });
    expect(sent.map(({ key }) => key)).toContain('GET /console/forms?status=published');
  });

  it('asks for the next page once however often the button is pressed, and says what happened', async () => {
    const sent = stubApi({
      'GET /console/forms': ok({ forms: [summaryOf()], nextCursor: 'page2' }),
      'GET /console/forms?cursor=page2': ok({ forms: [published], nextCursor: null }),
    });
    openForms('/forms');

    const button = await screen.findByRole('button', { name: 'Show more forms' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(screen.getByText('Loading more forms').getAttribute('role')).toBe('status');

    expect(await screen.findByText('More forms loaded. Showing 2 in all.')).toBeTruthy();
    expect(sent.filter(({ key }) => key.includes('cursor=page2'))).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: 'Spring survey' })).toHaveLength(1);
  });

  it('says what to do when there are no forms', async () => {
    stubApi({ 'GET /console/forms': ok({ forms: [], nextCursor: null }) });
    openForms('/forms');

    expect(await screen.findByRole('heading', { name: 'No forms yet' })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Create form' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Start from a template' }).length).toBeGreaterThan(
      0,
    );
  });

  it('shows the not-found page to a member without the permission, and asks for nothing', async () => {
    const sent = stubApi({});
    openForms('/forms', ['grants.programmes.manage']);

    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy();
    expect(sent).toHaveLength(0);
  });

  it('says why a list could not load and offers to try again', async () => {
    stubApi({ 'GET /console/forms': problem(500, 'The server could not read the forms.') });
    openForms('/forms');

    expect(await screen.findByText('The server could not read the forms.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

describe('creating a form', () => {
  it('asks only for a title, sends one create and opens the new draft', async () => {
    const user = userEvent.setup();
    const sent = stubApi({
      'POST /console/forms': () => ({ status: 201, body: form }),
      [`GET /console/forms/${formId}`]: ok(form),
      [`GET /console/forms/${formId}/draft`]: ok({
        formId,
        definition: null,
        updatedAt: form.updatedAt,
      }),
      [`GET /console/forms/${formId}/versions`]: ok({ versions: [] }),
    });
    openForms('/forms/new');

    await user.type(await screen.findByLabelText('Form title'), 'Drop-in feedback');
    await user.click(screen.getByRole('button', { name: 'Create form' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Drop-in feedback' })).toBeTruthy();
    const creates = sent.filter(({ key }) => key === 'POST /console/forms');
    expect(creates).toHaveLength(1);
    expect(creates[0]?.idempotencyKey).toBeTruthy();
    expect(creates[0]?.body).toMatchObject({ title: 'Drop-in feedback', respondents: 'signed_in' });
    expect(window.location.pathname).toBe(`/forms/${formId}`);
  });

  it('reuses the key when a try may not have arrived, so one form is created', async () => {
    const user = userEvent.setup();
    let tries = 0;
    const sent = stubApi({
      'POST /console/forms': () => {
        tries += 1;
        return tries === 1
          ? problem(500, 'The server stopped before it answered.')
          : { status: 201, body: form };
      },
      [`GET /console/forms/${formId}`]: ok(form),
      [`GET /console/forms/${formId}/draft`]: ok({
        formId,
        definition: null,
        updatedAt: form.updatedAt,
      }),
      [`GET /console/forms/${formId}/versions`]: ok({ versions: [] }),
    });
    openForms('/forms/new');

    await user.type(await screen.findByLabelText('Form title'), 'Drop-in feedback');
    await user.click(screen.getByRole('button', { name: 'Create form' }));
    expect(
      (await screen.findAllByText('The server stopped before it answered.')).length,
    ).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Create form' }));
    await screen.findByRole('heading', { level: 1, name: 'Drop-in feedback' });

    const keys = sent
      .filter(({ key }) => key === 'POST /console/forms')
      .map(({ idempotencyKey }) => idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });

  it('says what to fix when the title is empty, and sends nothing', async () => {
    const user = userEvent.setup();
    const sent = stubApi({});
    openForms('/forms/new');

    await user.click(await screen.findByRole('button', { name: 'Create form' }));

    expect((await screen.findAllByText('Enter a title for the form.')).length).toBeGreaterThan(0);
    expect(sent).toHaveLength(0);
  });
});
