// SPDX-License-Identifier: AGPL-3.0-or-later

import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { form, formId } from '../fixtures.test.ts';
import { ok, openForms, problem, setUpFormsTests, stubApi } from '../harness.test.tsx';

setUpFormsTests();

const base = `/console/forms/${formId}`;

describe('the settings page', () => {
  it('shows times in UK time and sends them as UTC', async () => {
    const user = userEvent.setup();
    const sent = stubApi({
      [`GET ${base}`]: ok({ ...form, closesAt: '2027-03-28T01:30:00Z' }),
      [`PUT ${base}/settings`]: (body) => ok({ ...form, ...(body as object) }),
    });
    openForms(`/forms/${formId}/settings`);

    const closes = await screen.findByLabelText<HTMLInputElement>(/^Closes/);
    expect(closes.value).toBe('2027-03-28T02:30');
    fireEvent.change(screen.getByLabelText(/^Opens/), { target: { value: '2027-03-01T09:00' } });
    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(await screen.findByText('Settings saved.')).toBeTruthy();
    expect(sent.find(({ key }) => key === `PUT ${base}/settings`)?.body).toMatchObject({
      title: 'Drop-in feedback',
      opensAt: '2027-03-01T09:00:00Z',
      closesAt: '2027-03-28T01:30:00Z',
    });
  });

  it("says what is wrong in the catalogue's words and links the summary to the field", async () => {
    const user = userEvent.setup();
    stubApi({ [`GET ${base}`]: ok(form) });
    openForms(`/forms/${formId}/settings`);

    const title = await screen.findByLabelText('Title');
    await user.clear(title);
    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Enter a title for the form.');
    expect(alert.querySelector('a')?.getAttribute('href')).toBe('#settings-title');
  });

  it('changes retention after confirming it is the member, and keeps within the range', async () => {
    const user = userEvent.setup();
    const sent = stubApi({
      [`GET ${base}`]: ok(form),
      [`PUT ${base}/retention`]: (body) => ok({ ...form, ...(body as object) }),
    });
    openForms(`/forms/${formId}/settings`);

    const months = await screen.findByLabelText(/^Months to keep responses/);
    await user.clear(months);
    await user.type(months, '0');
    await user.click(screen.getByRole('button', { name: 'Change retention' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(sent.some(({ key }) => key.endsWith('/retention'))).toBe(false);

    await user.clear(months);
    await user.type(months, '24');
    await user.click(screen.getByRole('button', { name: 'Change retention' }));
    expect(await screen.findByText('Responses are kept for 24 months.')).toBeTruthy();
  });

  it('shows the not-found page for a form in another funder', async () => {
    stubApi({ [`GET ${base}`]: problem(404, 'We could not find that.') });
    openForms(`/forms/${formId}/settings`);

    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy();
  });
});
