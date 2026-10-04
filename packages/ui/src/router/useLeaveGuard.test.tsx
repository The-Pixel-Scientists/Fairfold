// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_LEAVE_MESSAGE } from './index.ts';
import { activeHeading, renderRouter, setUpRouterTests } from '../../test/routerTesting.tsx';

setUpRouterTests();

const dialog = () => screen.findByRole('dialog', { name: 'Leave this page?' });
const noDialog = () => {
  expect(screen.queryByRole('dialog')).toBeNull();
};

describe('useLeaveGuard', () => {
  it('does nothing while there is nothing unsaved', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    const user = userEvent.setup();
    renderRouter('/edit');

    await user.click(screen.getByRole('link', { name: 'Back to programmes' }));

    await screen.findByRole('heading', { level: 1, name: 'Programmes' });
    noDialog();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('opens a dialog, not the browser confirm, before a link leaves the page', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    const user = userEvent.setup();
    renderRouter('/edit');
    await user.type(screen.getByRole('textbox', { name: 'Programme name' }), 'Draft');

    await user.click(screen.getByRole('link', { name: 'Back to programmes' }));

    const open = await dialog();
    expect(within(open).getByText(DEFAULT_LEAVE_MESSAGE)).toBeTruthy();
    expect(
      within(open)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Leave and lose changes', 'Stay on this page']);
    expect(confirm).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/edit');
  });

  it('puts focus on the safe choice, and stays when the person stays, with focus back on the link', async () => {
    const user = userEvent.setup();
    renderRouter('/edit');
    await user.type(screen.getByRole('textbox', { name: 'Programme name' }), 'Draft');
    const link = screen.getByRole('link', { name: 'Back to programmes' });
    await user.click(link);

    const open = await dialog();
    expect(document.activeElement).toBe(
      within(open).getByRole('button', { name: 'Stay on this page' }),
    );
    await user.keyboard('{Enter}');

    await waitFor(noDialog);
    expect(window.location.pathname).toBe('/edit');
    expect(screen.getByRole('heading', { level: 1, name: 'Edit programme' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Programme name' })).toHaveProperty(
      'value',
      'Draft',
    );
    expect(document.activeElement).toBe(link);
  });

  it('stays when the person presses Escape', async () => {
    const user = userEvent.setup();
    renderRouter('/edit');
    await user.type(screen.getByRole('textbox', { name: 'Programme name' }), 'Draft');
    await user.click(screen.getByRole('link', { name: 'Back to programmes' }));
    await dialog();

    await user.keyboard('{Escape}');

    await waitFor(noDialog);
    expect(window.location.pathname).toBe('/edit');
  });

  it('leaves when the person agrees, and moves focus to the new page heading', async () => {
    const user = userEvent.setup();
    renderRouter('/edit');
    await user.type(screen.getByRole('textbox', { name: 'Programme name' }), 'Draft');
    await user.click(screen.getByRole('link', { name: 'Back to programmes' }));

    await user.click(
      within(await dialog()).getByRole('button', { name: 'Leave and lose changes' }),
    );

    expect(await screen.findByRole('heading', { level: 1, name: 'Programmes' })).toBeTruthy();
    expect(window.location.pathname).toBe('/');
    await waitFor(noDialog);
    await waitFor(() => {
      expect(activeHeading()).toBe('Programmes');
    });
  });

  it('puts the person back, and asks, when they press the back button', async () => {
    const user = userEvent.setup();
    renderRouter('/');
    await user.click(screen.getByRole('link', { name: 'Edit this programme' }));
    await screen.findByRole('heading', { level: 1, name: 'Edit programme' });
    await user.type(screen.getByRole('textbox', { name: 'Programme name' }), 'Draft');

    window.history.back();

    await dialog();
    await waitFor(() => {
      expect(window.location.pathname).toBe('/edit');
    });
    // The page behind the dialog is hidden from assistive technology, but still there.
    expect(
      screen.getByRole('heading', { level: 1, name: 'Edit programme', hidden: true }),
    ).toBeTruthy();

    // Staying leaves the person where they were.
    await user.click(screen.getByRole('button', { name: 'Stay on this page' }));
    await waitFor(noDialog);
    expect(window.location.pathname).toBe('/edit');
  });

  it('goes back when the person agrees to leave with the back button, and asks once', async () => {
    const user = userEvent.setup();
    renderRouter('/');
    await user.click(screen.getByRole('link', { name: 'Edit this programme' }));
    await screen.findByRole('heading', { level: 1, name: 'Edit programme' });
    await user.type(screen.getByRole('textbox', { name: 'Programme name' }), 'Draft');

    window.history.back();
    await user.click(
      within(await dialog()).getByRole('button', { name: 'Leave and lose changes' }),
    );

    await waitFor(() => {
      expect(activeHeading()).toBe('Programmes');
    });
    expect(window.location.pathname).toBe('/');
    await waitFor(noDialog);
  });

  it('shows the browser warning when the tab closes, but only while changes are unsaved', async () => {
    const user = userEvent.setup();
    renderRouter('/edit');

    const quiet = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(quiet);
    expect(quiet.defaultPrevented).toBe(false);

    await user.type(screen.getByRole('textbox', { name: 'Programme name' }), 'Draft');
    const warned = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(warned);
    expect(warned.defaultPrevented).toBe(true);
  });

  it('stops warning once the page is gone', async () => {
    const user = userEvent.setup();
    renderRouter('/edit');
    await user.type(screen.getByRole('textbox', { name: 'Programme name' }), 'Draft');
    await user.click(screen.getByRole('link', { name: 'Back to programmes' }));
    await user.click(
      within(await dialog()).getByRole('button', { name: 'Leave and lose changes' }),
    );
    await screen.findByRole('heading', { level: 1, name: 'Programmes' });

    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});
