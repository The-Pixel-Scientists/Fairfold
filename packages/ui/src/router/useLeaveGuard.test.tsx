// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_LEAVE_MESSAGE } from './index.ts';
import { activeHeading, renderRouter, setUpRouterTests } from '../../test/routerTesting.tsx';

setUpRouterTests();

describe('useLeaveGuard', () => {
  it('does nothing while there is nothing unsaved', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    renderRouter('/edit');

    await user.click(screen.getByRole('link', { name: 'Back to programmes' }));

    await screen.findByRole('heading', { level: 1, name: 'Programmes' });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('asks before a link leaves the page, and stays when the person declines', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    renderRouter('/edit');
    await user.type(screen.getByRole('textbox', { name: 'Programme name' }), 'Draft');

    await user.click(screen.getByRole('link', { name: 'Back to programmes' }));

    expect(confirm).toHaveBeenCalledWith(DEFAULT_LEAVE_MESSAGE);
    expect(window.location.pathname).toBe('/edit');
    expect(screen.getByRole('heading', { level: 1, name: 'Edit programme' })).toBeTruthy();
  });

  it('leaves when the person agrees', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    renderRouter('/edit');
    await user.type(screen.getByRole('textbox', { name: 'Programme name' }), 'Draft');

    await user.click(screen.getByRole('link', { name: 'Back to programmes' }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('heading', { level: 1, name: 'Programmes' })).toBeTruthy();
    expect(window.location.pathname).toBe('/');
  });

  it('puts the person back when they decline to leave with the back button', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    renderRouter('/');
    await user.click(screen.getByRole('link', { name: 'Edit this programme' }));
    await screen.findByRole('heading', { level: 1, name: 'Edit programme' });
    await user.type(screen.getByRole('textbox', { name: 'Programme name' }), 'Draft');

    window.history.back();

    await waitFor(() => {
      expect(confirm).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(window.location.pathname).toBe('/edit');
    });
    expect(screen.getByRole('heading', { level: 1, name: 'Edit programme' })).toBeTruthy();

    // After agreeing, back works as normal.
    confirm.mockReturnValue(true);
    window.history.back();
    await waitFor(() => {
      expect(activeHeading()).toBe('Programmes');
    });
    expect(window.location.pathname).toBe('/');
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
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    renderRouter('/edit');
    await user.type(screen.getByRole('textbox', { name: 'Programme name' }), 'Draft');
    await user.click(screen.getByRole('link', { name: 'Back to programmes' }));
    await screen.findByRole('heading', { level: 1, name: 'Programmes' });

    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});
