// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { productName } from '@pixel-scientists/domain/platform';

import { App } from './App.tsx';

// Loading a page is an import(), which a busy machine can take many seconds over.
// Testing Library waits one second by default and Vitest five, so wait longer.
const LOAD_TIMEOUT = 15_000;
const TEST_TIMEOUT = 30_000;

// A page whose code cannot be fetched, as on a lost connection.
vi.mock('./pages/HowApplyingWorksPage.tsx', () => {
  throw new Error('Failed to fetch dynamically imported module');
});

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  // React logs the error the page boundary catches.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
  document.title = '';
});

describe('a page that fails to load', () => {
  it(
    'tells an applicant what to do in plain words, with focus, title and announcement',
    { timeout: TEST_TIMEOUT },
    async () => {
      const user = userEvent.setup();
      window.history.replaceState(null, '', '/');
      render(<App />);
      await screen.findByRole(
        'heading',
        { level: 1, name: 'Apply for a grant' },
        { timeout: LOAD_TIMEOUT },
      );

      await user.click(screen.getByRole('link', { name: 'Read how applying works' }));

      const heading = await screen.findByRole(
        'heading',
        { level: 1, name: 'We could not load this page' },
        { timeout: LOAD_TIMEOUT },
      );
      await waitFor(
        () => {
          expect(document.activeElement).toBe(heading);
        },
        { timeout: LOAD_TIMEOUT },
      );
      expect(document.title).toBe(`We could not load this page – ${productName}`);
      expect(screen.getByRole('status').textContent).toBe('We could not load this page');
      expect(screen.getByRole('main').textContent).toMatch(
        /Check that you are online, then reload the page\. If it still does not load, try again in a few minutes\./,
      );
      expect(screen.getByRole('main').textContent).not.toMatch(/administrator|sorry|error/i);
      expect(screen.getByRole('button', { name: 'Reload page' })).toBeTruthy();
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    },
  );
});
