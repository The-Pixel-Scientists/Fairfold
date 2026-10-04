// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { productName } from '@pixel-scientists/domain/platform';

import { titleSuffix } from './product.ts';
import { signedOut, stubApi } from './testing/api.ts';
import { expectTitle, openConsole, setUpConsoleTests } from './testing/render.tsx';

setUpConsoleTests();

const heading = (name: string) => screen.findByRole('heading', { level: 1, name });

describe('the console outside a funder', () => {
  it('shows the component gallery in the shell, with a title that says where you are', async () => {
    openConsole('/dev/components');

    await heading('Component gallery');

    await expectTitle(`Component gallery – ${titleSuffix}`);
    expect(screen.getByRole('banner').textContent).toContain(productName);
    expect(screen.getByRole('main').contains(screen.getByRole('heading', { level: 1 }))).toBe(true);
    // Outside a funder there is no session, so there is no navigation.
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('puts the skip link first and moves focus to the main content from the keyboard', async () => {
    const user = userEvent.setup();
    openConsole('/dev/components');
    await heading('Component gallery');

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Skip to main content' }));
    await user.keyboard('{Enter}');

    expect(document.activeElement).toBe(screen.getByRole('main'));
  });

  it('moves to another page by keyboard, with focus on the new heading and a new title', async () => {
    const user = userEvent.setup();
    openConsole('/dev/components');
    await heading('Component gallery');

    screen.getByRole('link', { name: 'Open a page that does not exist' }).focus();
    await user.keyboard('{Enter}');

    const next = await heading('Page not found');
    await waitFor(() => {
      expect(document.activeElement).toBe(next);
    });
    await expectTitle(`Page not found – ${titleSuffix}`);
    expect(window.location.pathname).toBe('/does-not-exist');
  });

  it('says so, and offers a way home, when the address matches nothing', async () => {
    openConsole('/Nothing/here');

    await heading('Page not found');

    await expectTitle(`Page not found – ${titleSuffix}`);
    expect(screen.getByRole('link', { name: 'Go to the home page' }).getAttribute('href')).toBe(
      '/',
    );
  });
});

describe('the console in a funder', () => {
  it('asks a visitor who is not signed in to sign in, whatever page they asked for', async () => {
    stubApi({ 'GET /auth/session': signedOut });
    openConsole('/northfield/nothing/here');

    await heading('Sign in');

    expect(window.location.pathname).toBe('/northfield/sign-in');
    expect(window.location.search).toBe('?next=%2Fnothing%2Fhere');
  });
});
