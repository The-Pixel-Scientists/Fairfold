// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Test helpers: open the console at an address, and put the page back
// between tests. Not part of the app.

import { cleanup, configure, render, waitFor } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { afterEach, beforeEach, expect, vi } from 'vitest';

import { App } from '../App.tsx';

/** Show the console as if the browser had opened `path`. */
export function openConsole(path: string): RenderResult {
  window.history.replaceState(null, '', path);
  return render(<App />);
}

/** The router sets the title once the page has shown, so wait for it. */
export async function expectTitle(title: string): Promise<void> {
  await waitFor(() => {
    expect(document.title).toBe(title);
  });
}

/**
 * Call once at the top of a test file. Pages load on demand, and the first
 * load of a page in a busy test run can take longer than Testing Library's
 * default second, so it waits longer for what it looks for.
 */
export function setUpConsoleTests(): void {
  configure({ asyncUtilTimeout: 5000 });

  beforeEach(() => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    window.history.replaceState(null, '', '/');
    document.title = '';
  });
}
