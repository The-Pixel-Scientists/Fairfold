// SPDX-License-Identifier: AGPL-3.0-or-later

/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInThisContext } from 'node:vm';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The file the apps load in the head of index.html, run here as the browser runs it.
const script = readFileSync(join(import.meta.dirname, '..', 'public', 'scheme.js'), 'utf8');

const KEY = 'colour-scheme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

/** The scheme the script puts on the page element for a device that is dark or light. */
function boot(deviceIsDark: boolean): string | undefined {
  const queries: string[] = [];
  window.matchMedia = (query: string) => {
    queries.push(query);
    return { media: query, matches: query === DARK_QUERY && deviceIsDark } as MediaQueryList;
  };
  runInThisContext(script);
  expect(queries.every((query) => query === DARK_QUERY)).toBe(true);
  return document.documentElement.dataset['scheme'];
}

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset['scheme'];
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  delete document.documentElement.dataset['scheme'];
});

describe('public/scheme.js', () => {
  it.each([true, false])(
    'shows a stored dark choice, whether the device is dark (%s) or not',
    (device) => {
      window.localStorage.setItem(KEY, 'dark');

      expect(boot(device)).toBe('dark');
    },
  );

  it.each([true, false])(
    'shows a stored light choice, whether the device is dark (%s) or not',
    (device) => {
      window.localStorage.setItem(KEY, 'light');

      expect(boot(device)).toBe('light');
    },
  );

  it('follows a dark device when nothing is stored', () => {
    expect(boot(true)).toBe('dark');
  });

  it('follows a light device when nothing is stored', () => {
    expect(boot(false)).toBe('light');
  });

  it.each([true, false])('ignores a stored value it does not know (device dark: %s)', (device) => {
    window.localStorage.setItem(KEY, 'sepia');

    expect(boot(device)).toBe(device ? 'dark' : 'light');
  });

  it('is case sensitive about the stored value, as the switch is', () => {
    window.localStorage.setItem(KEY, 'Dark');

    expect(boot(false)).toBe('light');
  });

  describe('when storage throws', () => {
    const blocked = () => {
      throw new DOMException('Storage is blocked.', 'SecurityError');
    };

    it.each([true, false])('follows the device (dark: %s) when getItem throws', (device) => {
      const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);

      expect(boot(device)).toBe(device ? 'dark' : 'light');
      expect(getItem).toHaveBeenCalledWith(KEY);
    });

    it.each([true, false])(
      'follows the device (dark: %s) when reaching storage throws',
      (device) => {
        const storage = vi.spyOn(window, 'localStorage', 'get').mockImplementation(blocked);

        expect(boot(device)).toBe(device ? 'dark' : 'light');
        expect(storage).toHaveBeenCalled();
      },
    );
  });

  it('sets the attribute on the page element, and nothing else', () => {
    window.localStorage.setItem(KEY, 'dark');

    boot(false);

    expect(document.documentElement.getAttributeNames()).toEqual(['data-scheme']);
    expect(document.body.getAttributeNames()).toEqual([]);
    expect(window.localStorage.getItem(KEY)).toBe('dark');
    expect(window.localStorage.length).toBe(1);
  });

  it('leaves no global behind', () => {
    const before = Object.keys(globalThis);

    boot(true);

    expect(Object.keys(globalThis).filter((name) => !before.includes(name))).toEqual([]);
  });
});
