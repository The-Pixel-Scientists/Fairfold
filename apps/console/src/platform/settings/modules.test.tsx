// SPDX-License-Identifier: AGPL-3.0-or-later

import { messages } from '@pixel-scientists/domain/platform';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { consoleSession, problem, stubApi } from '../../testing/api.ts';
import { expectTitle, openConsole, setUpConsoleTests } from '../../testing/render.tsx';
import { SESSION, administrator, heading, ok } from './testing.ts';

setUpConsoleTests();

const MODULES = 'GET /console/settings/modules';
const SWITCH = 'PATCH /console/settings/modules';
const grants = (enabled: boolean) => ({ modules: [{ module: 'grants', enabled }] });

async function openModules(handlers: Record<string, Parameters<typeof stubApi>[0][string]> = {}) {
  const sent = stubApi({
    [SESSION]: ok(administrator()),
    [MODULES]: ok(grants(true)),
    ...handlers,
  });
  openConsole('/northfield/settings/modules');
  await heading('Modules');
  return sent;
}

describe('the modules page', () => {
  it('says whether Grants is on, and what it covers', async () => {
    await openModules();

    expect(await screen.findByRole('heading', { level: 3, name: 'Grants is on' })).toBeTruthy();
    expect(screen.getByText(/Programmes, forms, applications, reviews and decisions/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Switch off Grants' })).toBeTruthy();
    await expectTitle('Modules – Fairfold Grants console');
  });

  it('says that Grants is off, and offers to switch it on without asking', async () => {
    const user = userEvent.setup();
    const sent = await openModules({
      [MODULES]: ok(grants(false)),
      [SWITCH]: ok(grants(true)),
    });
    expect(await screen.findByRole('heading', { level: 3, name: 'Grants is off' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Switch on Grants' }));

    expect(await screen.findByText('Grants is now on.')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(sent.find(({ key }) => key === SWITCH)?.body).toEqual({
      module: 'grants',
      enabled: true,
    });
    expect(screen.getByRole('heading', { level: 3, name: 'Grants is on' })).toBeTruthy();
  });

  it('asks before switching Grants off, and says its data stays and returns', async () => {
    const user = userEvent.setup();
    const sent = await openModules({ [SWITCH]: ok(grants(false)) });
    await user.click(await screen.findByRole('button', { name: 'Switch off Grants' }));

    const dialog = await screen.findByRole('dialog', { name: 'Switch off Grants?' });
    expect(dialog.textContent).toContain(
      'Nothing is deleted: its data stays and returns when you switch Grants on again.',
    );
    expect(document.activeElement).toBe(
      within(dialog).getByRole('button', { name: 'Keep Grants on' }),
    );
    expect(sent.map(({ key }) => key)).not.toContain(SWITCH);

    await user.click(within(dialog).getByRole('button', { name: 'Switch off Grants' }));

    expect(await screen.findByText('Grants is now off.')).toBeTruthy();
    expect(sent.find(({ key }) => key === SWITCH)?.body).toEqual({
      module: 'grants',
      enabled: false,
    });
    expect(screen.getByRole('heading', { level: 3, name: 'Grants is off' })).toBeTruthy();
  });

  it('changes nothing when the person keeps Grants on, and returns focus to the button', async () => {
    const user = userEvent.setup();
    const sent = await openModules();
    const opener = await screen.findByRole('button', { name: 'Switch off Grants' });
    await user.click(opener);

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(sent.map(({ key }) => key)).not.toContain(SWITCH);
    expect(document.activeElement).toBe(opener);
  });

  it('reads the session again after a switch, so what the person may do follows it', async () => {
    const user = userEvent.setup();
    let reads = 0;
    await openModules({
      [SESSION]: () => {
        reads += 1;
        return ok(administrator());
      },
      [SWITCH]: ok(grants(false)),
    });
    await user.click(await screen.findByRole('button', { name: 'Switch off Grants' }));
    const dialog = await screen.findByRole('dialog', { name: 'Switch off Grants?' });
    await user.click(within(dialog).getByRole('button', { name: 'Switch off Grants' }));

    await screen.findByText('Grants is now off.');
    expect(reads).toBe(2);
  });

  it('says what went wrong when a switch is refused, and keeps the state', async () => {
    const user = userEvent.setup();
    await openModules({ [SWITCH]: problem(403, 'You cannot change modules.') });
    await user.click(await screen.findByRole('button', { name: 'Switch off Grants' }));
    const dialog = await screen.findByRole('dialog', { name: 'Switch off Grants?' });

    await user.click(within(dialog).getByRole('button', { name: 'Switch off Grants' }));

    expect((await screen.findByRole('alert')).textContent).toBe('You cannot change modules.');
    expect(screen.getByRole('heading', { level: 3, name: 'Grants is on' })).toBeTruthy();
  });

  it('says what went wrong, and offers to try again, when the modules cannot be read', async () => {
    stubApi({
      [SESSION]: ok(administrator()),
      [MODULES]: problem(500, messages.serviceFailed),
    });
    openConsole('/northfield/settings/modules');

    expect(await screen.findByText('We could not load this page')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('says what to do for someone who may not change settings', async () => {
    stubApi({ [SESSION]: ok(consoleSession({ roles: ['reviewer'] })) });
    openConsole('/northfield/settings/modules');

    expect(await heading('Settings')).toBeTruthy();
    expect(screen.getByText("You cannot change this funder's settings")).toBeTruthy();
  });
});
