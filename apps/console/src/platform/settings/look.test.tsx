// SPDX-License-Identifier: AGPL-3.0-or-later

import { messages } from '@pixel-scientists/domain/platform';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { consoleSession, problem, stubApi } from '../../testing/api.ts';
import { expectTitle, openConsole, setUpConsoleTests } from '../../testing/render.tsx';
import { SESSION, administrator, heading, ok, publicTenant, theme } from './testing.ts';

setUpConsoleTests();

const THEME = 'GET /console/settings/theme';
const SAVE = 'PUT /console/settings/theme';
const PUBLIC = 'GET /public/tenants/northfield';

const colourField = () => screen.getByRole<HTMLInputElement>('textbox', { name: 'Brand colour' });
const preview = () => document.querySelector<HTMLElement>('[inert]');
const previewColour = () => preview()?.style.getPropertyValue('--color-accent');

async function openLook(handlers: Record<string, Parameters<typeof stubApi>[0][string]> = {}) {
  const sent = stubApi({
    [SESSION]: ok(administrator()),
    [THEME]: ok(theme()),
    ...handlers,
  });
  openConsole('/northfield/settings/look');
  await heading('Look and logo');
  await screen.findByRole('textbox', { name: 'Brand colour' });
  return sent;
}

describe('the look page', () => {
  it('shows the saved colour and preset, with the section links and a title that says where you are', async () => {
    await openLook({ [THEME]: ok(theme({ brandColour: '#0b5d3b', preset: 'rounded' })) });

    expect(colourField().value).toBe('#0b5d3b');
    expect(screen.getByRole('radio', { name: 'Rounded' })).toHaveProperty('checked', true);
    const sections = screen.getByRole('navigation', { name: 'Settings' });
    expect(within(sections).getByRole('link', { name: 'Look' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(
      within(sections).getByRole('link', { name: 'General' }).getAttribute('aria-current'),
    ).toBeNull();
    await expectTitle('Look and logo – Fairfold Grants console');
    expect(screen.getByText('This colour passes the contrast check.')).toBeTruthy();
    expect(previewColour()).toBe('#0b5d3b');
  });

  it('shows that it is loading, then says what went wrong and tries again', async () => {
    const user = userEvent.setup();
    let reads = 0;
    stubApi({
      [SESSION]: ok(administrator()),
      [THEME]: () => {
        reads += 1;
        return reads === 1
          ? problem(503, 'The service is busy. Try again in a minute.')
          : ok(theme());
      },
    });
    openConsole('/northfield/settings/look');

    expect(await screen.findByText('We could not load this page')).toBeTruthy();
    expect(screen.getByText('The service is busy. Try again in a minute.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('textbox', { name: 'Brand colour' })).toBeTruthy();
  });

  it('refuses a colour that is too light as it is typed: the words, the contrast found and a colour to use', async () => {
    const user = userEvent.setup();
    await openLook();

    await user.clear(colourField());
    await user.type(colourField(), '#ffee00');

    expect(colourField().getAttribute('aria-invalid')).toBe('true');
    expect(screen.getAllByText(/This colour is too light to read/).length).toBeGreaterThan(0);
    expect(
      screen.getByText(/^Contrast found: \d\.\d to 1\. The minimum is 4\.5 to 1\.$/),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Use #[0-9a-f]{6}$/ })).toBeTruthy();
    expect(screen.queryByText('This colour passes the contrast check.')).toBeNull();
  });

  it('says nothing while the colour is still being typed', async () => {
    const user = userEvent.setup();
    await openLook();

    await user.clear(colourField());
    await user.type(colourField(), '#ffee');

    expect(screen.queryByText(/Contrast found/)).toBeNull();
    expect(screen.queryByText('This colour passes the contrast check.')).toBeNull();
  });

  it('puts the colour that passes in the field when the person uses it, and keeps focus there', async () => {
    const user = userEvent.setup();
    await openLook();
    await user.clear(colourField());
    await user.type(colourField(), '#ffee00');

    await user.click(screen.getByRole('button', { name: /^Use #[0-9a-f]{6}$/ }));

    expect(colourField().value).toMatch(/^#[0-9a-f]{6}$/);
    expect(colourField().value).not.toBe('#ffee00');
    expect(screen.queryByText(/Contrast found/)).toBeNull();
    expect(screen.getByText('This colour passes the contrast check.')).toBeTruthy();
    expect(document.activeElement).toBe(colourField());
  });

  it('keeps the preview on the saved colour until the typed one passes, then shows it', async () => {
    const user = userEvent.setup();
    await openLook();
    expect(previewColour()).toBe('#1f4bb8');

    await user.clear(colourField());
    await user.type(colourField(), '#ffee00');
    expect(previewColour()).toBe('#1f4bb8');
    expect(
      screen.getByText('The preview keeps your saved colour until this one passes.'),
    ).toBeTruthy();

    await user.clear(colourField());
    await user.type(colourField(), '#0B5D3B');
    expect(previewColour()).toBe('#0b5d3b');
    expect(screen.queryByText(/The preview keeps/)).toBeNull();
  });

  it('still opens when the saved colour no longer passes, so it can be changed', async () => {
    await openLook({ [THEME]: ok(theme({ brandColour: '#ffee00' })) });

    expect(colourField().value).toBe('#ffee00');
    expect(screen.getByRole('button', { name: /^Use #[0-9a-f]{6}$/ })).toBeTruthy();
    expect(preview()?.getAttribute('style')).toBeNull();
  });

  it('shows the preview in the chosen preset, with its buttons, link and header out of reach', async () => {
    const user = userEvent.setup();
    await openLook();
    expect(preview()?.style.getPropertyValue('--radius-md')).toBe('0.375rem');

    await user.click(screen.getByRole('radio', { name: 'Square' }));

    expect(preview()?.style.getPropertyValue('--radius-md')).toBe('0');
    expect(preview()?.getAttribute('aria-hidden')).toBe('true');
    expect(within(preview() as HTMLElement).queryAllByRole('button')).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Save programme' })).toBeNull();
  });

  it('chooses a preset with the arrow keys', async () => {
    const user = userEvent.setup();
    await openLook();

    screen.getByRole('radio', { name: 'Standard' }).focus();
    await user.keyboard('{ArrowDown}');

    expect(screen.getByRole('radio', { name: 'Rounded' })).toHaveProperty('checked', true);
  });

  it("saves the colour and preset, says so, and reads the funder's look again", async () => {
    const user = userEvent.setup();
    let saved = false;
    const sent = await openLook({
      [SAVE]: (body) => {
        saved = true;
        return ok({ ...(body as object), hasLogo: false });
      },
      [PUBLIC]: () => ok(publicTenant(saved ? { brandColour: '#0b5d3b', preset: 'square' } : {})),
    });
    await user.clear(colourField());
    await user.type(colourField(), '#0B5D3B');
    await user.click(screen.getByRole('radio', { name: 'Square' }));

    await user.click(screen.getByRole('button', { name: 'Save look' }));

    expect(await screen.findByText('Look saved.')).toBeTruthy();
    expect(sent.find(({ key }) => key === SAVE)?.body).toEqual({
      brandColour: '#0b5d3b',
      preset: 'square',
    });
    // Once when the page opened, and again after the save.
    expect(sent.filter(({ key }) => key === PUBLIC)).toHaveLength(2);
    await waitFor(() => {
      expect(document.documentElement.dataset['preset']).toBe('square');
    });
    expect(colourField().value).toBe('#0b5d3b');
  });

  it('sends nothing for a colour that fails, and lists the problem at the top and beside the field', async () => {
    const user = userEvent.setup();
    const sent = await openLook();
    await user.clear(colourField());
    await user.type(colourField(), '#ffee00');

    await user.click(screen.getByRole('button', { name: 'Save look' }));

    const summary = await screen.findByRole('alert', { name: 'There is a problem' });
    expect(within(summary).getByRole('link').textContent).toMatch(/This colour is too light/);
    expect(sent.map(({ key }) => key)).not.toContain(SAVE);
    expect(screen.queryByText('Look saved.')).toBeNull();
  });

  it('asks for a hex code when the colour is not one, before sending anything', async () => {
    const user = userEvent.setup();
    const sent = await openLook();
    await user.clear(colourField());
    await user.type(colourField(), 'blue');

    await user.click(screen.getByRole('button', { name: 'Save look' }));

    expect((await screen.findAllByText(messages.brandColourFormat)).length).toBeGreaterThan(0);
    expect(colourField().getAttribute('aria-invalid')).toBe('true');
    expect(sent.map(({ key }) => key)).not.toContain(SAVE);
  });

  it("shows the API's refusal of a colour the same way: its words, the contrast and a colour to use", async () => {
    const user = userEvent.setup();
    await openLook({
      [SAVE]: problem(400, messages.fixFields, [
        { field: 'body.brandColour', message: messages.brandColourContrast('#123456') },
      ]),
    });
    await user.clear(colourField());
    await user.type(colourField(), '#2255aa');

    await user.click(screen.getByRole('button', { name: 'Save look' }));

    expect((await screen.findAllByText(/This colour is too light to read/)).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText(/^Contrast found:/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Use #123456' })).toBeTruthy();

    // The refusal is about that colour, so it goes from the field once the colour changes. The summary stays until the next save.
    await user.type(colourField(), '0');
    expect(screen.queryByRole('button', { name: 'Use #123456' })).toBeNull();
    expect(colourField().getAttribute('aria-invalid')).toBeNull();
  });

  it('asks before leaving with a colour that is not saved, and not once it is', async () => {
    const user = userEvent.setup();
    await openLook({ [SAVE]: (body) => ok({ ...(body as object), hasLogo: false }) });
    await user.clear(colourField());
    await user.type(colourField(), '#0b5d3b');

    await user.click(screen.getByRole('link', { name: 'General' }));

    const dialog = await screen.findByRole('dialog', { name: 'Leave this page?' });
    await user.click(within(dialog).getByRole('button', { name: 'Stay on this page' }));
    expect(window.location.pathname).toBe('/northfield/settings/look');
    expect(colourField().value).toBe('#0b5d3b');

    await user.click(screen.getByRole('button', { name: 'Save look' }));
    await screen.findByText('Look saved.');
    stubApi({
      [SESSION]: ok(administrator()),
      'GET /console/settings': ok({
        name: 'Northfield Foundation',
        timeZone: 'Europe/London',
        fiscalYearStartMonth: 4,
      }),
    });
    await user.click(screen.getByRole('link', { name: 'General' }));
    expect(await heading('General settings')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('who may open the settings', () => {
  it('tells someone without the permission what to do, and loads nothing', async () => {
    const sent = stubApi({ [SESSION]: ok(consoleSession({ roles: ['programme_manager'] })) });
    openConsole('/northfield/settings/look');

    expect(await heading('Settings')).toBeTruthy();
    expect(screen.getByText("You cannot change this funder's settings")).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Brand colour' })).toBeNull();
    expect(sent.map(({ key }) => key)).toEqual([SESSION]);
  });

  it('is in the navigation for an administrator', async () => {
    stubApi({ [SESSION]: ok(administrator()) });
    openConsole('/northfield/');

    const navigation = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(navigation).getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe(
      '/northfield/settings',
    );
  });

  it('is not in the navigation for a programme manager', async () => {
    stubApi({ [SESSION]: ok(consoleSession({ roles: ['programme_manager'] })) });
    openConsole('/northfield/');

    await heading('Programmes');
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
  });
});
