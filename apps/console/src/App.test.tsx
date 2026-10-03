// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App.tsx';

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
  document.title = '';
});

function openConsole(path = '/') {
  window.history.replaceState(null, '', path);
  return render(<App />);
}

describe('console', () => {
  it('shows the programmes page in the shell, with a title that says where you are', async () => {
    openConsole();

    expect(await screen.findByRole('heading', { level: 1, name: 'Programmes' })).toBeTruthy();
    expect(document.title).toBe('Programmes – PixelGrant console');
    expect(screen.getByRole('banner').textContent).toContain('PixelGrant');
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy();
    expect(screen.getByRole('main').contains(screen.getByRole('heading', { level: 1 }))).toBe(true);
  });

  it('has exactly one h1', async () => {
    openConsole();
    await screen.findByRole('heading', { level: 1, name: 'Programmes' });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('shows an empty state that says what to do next', async () => {
    openConsole();

    expect(
      await screen.findByRole('heading', { level: 2, name: 'No programmes yet' }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Ask your administrator to set up a programme, or to add you to one that exists.',
      ),
    ).toBeTruthy();
  });

  it('marks the current page in the navigation', async () => {
    openConsole();
    await screen.findByRole('heading', { level: 1, name: 'Programmes' });
    expect(screen.getByRole('link', { name: 'Programmes' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('puts the skip link first and moves focus to the main content from the keyboard', async () => {
    const user = userEvent.setup();
    openConsole();
    await screen.findByRole('heading', { level: 1, name: 'Programmes' });

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Skip to main content' }));
    await user.keyboard('{Enter}');

    expect(document.activeElement).toBe(screen.getByRole('main'));
  });

  it('moves to another page by keyboard, with focus on the new heading and a new title', async () => {
    const user = userEvent.setup();
    openConsole();
    await screen.findByRole('heading', { level: 1, name: 'Programmes' });

    screen.getByRole('link', { name: 'Component gallery' }).focus();
    await user.keyboard('{Enter}');

    const heading = await screen.findByRole('heading', { level: 1, name: 'Component gallery' });
    await waitFor(() => {
      expect(document.activeElement).toBe(heading);
    });
    expect(document.title).toBe('Component gallery – PixelGrant console');
    expect(window.location.pathname).toBe('/dev/components');
  });

  it('says so, and offers a way home, when the address matches nothing', async () => {
    openConsole('/nothing/here');

    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy();
    expect(document.title).toBe('Page not found – PixelGrant console');
    expect(screen.getByRole('link', { name: 'Go to the home page' }).getAttribute('href')).toBe(
      '/',
    );
  });
});
