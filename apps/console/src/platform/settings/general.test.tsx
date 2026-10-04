// SPDX-License-Identifier: AGPL-3.0-or-later

import { messages } from '@pixel-scientists/domain/platform';
import { timeZones } from '@pixel-scientists/domain/platform/settings';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { problem, stubApi } from '../../testing/api.ts';
import { expectTitle, openConsole, setUpConsoleTests } from '../../testing/render.tsx';
import { SESSION, administrator, heading, ok, publicTenant } from './testing.ts';

setUpConsoleTests();

const SETTINGS = 'GET /console/settings';
const SAVE = 'PUT /console/settings';
const PUBLIC = 'GET /public/tenants/northfield';
const saved = { name: 'Northfield Foundation', timeZone: 'Europe/London', fiscalYearStartMonth: 4 };

const nameField = () => screen.getByRole<HTMLInputElement>('textbox', { name: 'Funder name' });
const zoneField = () => screen.getByRole<HTMLSelectElement>('combobox', { name: 'Time zone' });
const monthField = () =>
  screen.getByRole<HTMLSelectElement>('combobox', { name: 'Financial year starts in' });

async function openGeneral(handlers: Record<string, Parameters<typeof stubApi>[0][string]> = {}) {
  const sent = stubApi({ [SESSION]: ok(administrator()), [SETTINGS]: ok(saved), ...handlers });
  openConsole('/northfield/settings');
  await heading('General settings');
  await screen.findByRole('textbox', { name: 'Funder name' });
  return sent;
}

// jsdom is slow to draw a list of every time zone, and the first test loads the page too.
describe('the general settings page', { timeout: 20_000 }, () => {
  it('shows the name, time zone and financial year start, in a list of every time zone', async () => {
    await openGeneral();

    expect(nameField().value).toBe('Northfield Foundation');
    expect(zoneField().value).toBe('Europe/London');
    expect(zoneField().options).toHaveLength(timeZones.length);
    expect(monthField().value).toBe('4');
    expect(monthField().options).toHaveLength(12);
    expect(within(monthField()).getByRole('option', { name: 'April' })).toBeTruthy();
    await expectTitle('General settings – Fairfold Grants console');
    expect(
      within(screen.getByRole('navigation', { name: 'Settings' }))
        .getByRole('link', { name: 'General' })
        .getAttribute('aria-current'),
    ).toBe('page');
  });

  it('keeps a stored time zone this browser does not list', async () => {
    await openGeneral({ [SETTINGS]: ok({ ...saved, timeZone: 'Etc/Unlisted' }) });

    expect(zoneField().value).toBe('Etc/Unlisted');
  });

  it('shows that it is loading, then the words for a failure and a way to try again', async () => {
    const user = userEvent.setup();
    let reads = 0;
    stubApi({
      [SESSION]: ok(administrator()),
      [SETTINGS]: () => {
        reads += 1;
        return reads === 1 ? problem(500, messages.serviceFailed) : ok(saved);
      },
    });
    openConsole('/northfield/settings');

    expect(await screen.findByText('We could not load this page')).toBeTruthy();
    expect(screen.getByText(messages.serviceFailed)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('textbox', { name: 'Funder name' })).toBeTruthy();
  });

  it('saves the changes, says so, and updates the name in the header', async () => {
    const user = userEvent.setup();
    let renamed = false;
    const sent = await openGeneral({
      [SAVE]: (body) => {
        renamed = true;
        return ok(body);
      },
      [PUBLIC]: () =>
        ok(publicTenant({}, renamed ? 'Northfield Community Trust' : 'Northfield Foundation')),
    });
    await user.clear(nameField());
    await user.type(nameField(), 'Northfield Community Trust');
    await user.selectOptions(zoneField(), 'Europe/Paris');
    await user.selectOptions(monthField(), 'January');

    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(await screen.findByText('Settings saved.')).toBeTruthy();
    expect(sent.find(({ key }) => key === SAVE)?.body).toEqual({
      name: 'Northfield Community Trust',
      timeZone: 'Europe/Paris',
      fiscalYearStartMonth: 1,
    });
    await waitFor(() => {
      expect(
        within(screen.getByRole('banner')).getByText('Northfield Community Trust'),
      ).toBeTruthy();
    });
  });

  it("says what is wrong beside the field and in the summary, from the API's answer", async () => {
    const user = userEvent.setup();
    await openGeneral({
      [SAVE]: problem(400, messages.fixFields, [
        { field: 'body.name', message: messages.tenantNameVisible },
      ]),
    });
    await user.type(nameField(), '!');

    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    const summary = await screen.findByRole('alert', { name: 'There is a problem' });
    expect(within(summary).getByRole('link').textContent).toBe(messages.tenantNameVisible);
    expect(nameField().getAttribute('aria-invalid')).toBe('true');
    expect(screen.queryByText('Settings saved.')).toBeNull();
  });

  it('checks the name before sending, so an empty name is never sent', async () => {
    const user = userEvent.setup();
    const sent = await openGeneral();
    await user.clear(nameField());

    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(await screen.findByRole('alert', { name: 'There is a problem' })).toBeTruthy();
    expect(sent.map(({ key }) => key)).not.toContain(SAVE);
  });

  it('opens a dialog, not the browser confirm, before leaving with changes that are not saved', async () => {
    const user = userEvent.setup();
    await openGeneral();
    await user.type(nameField(), ' Trust');

    await user.click(screen.getByRole('link', { name: 'Look' }));

    const dialog = await screen.findByRole('dialog', { name: 'Leave this page?' });
    expect(within(dialog).getByText(/You have unsaved changes/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Stay on this page' }));
    expect(window.location.pathname).toBe('/northfield/settings');
    expect(nameField().value).toBe('Northfield Foundation Trust');
  });

  it('leaves without asking when nothing has changed', async () => {
    const user = userEvent.setup();
    stubApi({
      [SESSION]: ok(administrator()),
      [SETTINGS]: ok(saved),
      'GET /console/settings/theme': ok({
        brandColour: '#1f4bb8',
        preset: 'standard',
        hasLogo: false,
      }),
    });
    openConsole('/northfield/settings');
    await screen.findByRole('textbox', { name: 'Funder name' });

    await user.click(screen.getByRole('link', { name: 'Look' }));

    expect(await heading('Look and logo')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
