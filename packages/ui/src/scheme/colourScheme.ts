// SPDX-License-Identifier: AGPL-3.0-or-later

import { useSyncExternalStore } from 'react';

export type ColourScheme = 'light' | 'dark';

/** What the person chose: a scheme, or whatever their device uses. */
export type SchemeChoice = 'device' | ColourScheme;

/** Where the choice is kept in this browser. public/scheme.js reads the same key. */
export const SCHEME_STORAGE_KEY = 'colour-scheme';

const DARK_QUERY = '(prefers-color-scheme: dark)';
const listeners = new Set<() => void>();
let current: SchemeChoice | undefined;

function storedChoice(): SchemeChoice {
  try {
    const stored = window.localStorage.getItem(SCHEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'device';
  } catch {
    return 'device';
  }
}

function getChoice(): SchemeChoice {
  current ??= storedChoice();
  return current;
}

/** Puts the scheme on the page element, as public/scheme.js does at load. */
function paint(): void {
  const choice = getChoice();
  const dark = choice === 'dark' || (choice === 'device' && window.matchMedia(DARK_QUERY).matches);
  document.documentElement.dataset['scheme'] = dark ? 'dark' : 'light';
}

function apply(): void {
  paint();
  for (const listener of listeners) listener();
}

/** Another tab changed the choice. */
function onStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== SCHEME_STORAGE_KEY) return;
  current = storedChoice();
  apply();
}

/** The device's scheme while anything listens: every matchMedia call gives a new list, so the same one is kept to remove the listener from. */
let device: MediaQueryList | undefined;

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    device = window.matchMedia(DARK_QUERY);
    device.addEventListener('change', apply);
    window.addEventListener('storage', onStorage);
    paint();
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    device?.removeEventListener('change', apply);
    device = undefined;
    window.removeEventListener('storage', onStorage);
  };
}

/** Changes the scheme at once and keeps the choice in this browser, for every app on this address. */
export function setSchemeChoice(choice: SchemeChoice): void {
  current = choice;
  try {
    if (choice === 'device') window.localStorage.removeItem(SCHEME_STORAGE_KEY);
    else window.localStorage.setItem(SCHEME_STORAGE_KEY, choice);
  } catch {
    // Storage can be blocked: the choice then lasts until the page is closed.
  }
  apply();
}

/**
 * The person's colour scheme choice. While any component uses it, the page
 * follows a change to the device's scheme, or to the choice in another tab.
 */
export function useSchemeChoice(): SchemeChoice {
  return useSyncExternalStore(subscribe, getChoice);
}

function shownScheme(): ColourScheme {
  return document.documentElement.dataset['scheme'] === 'dark' ? 'dark' : 'light';
}

/** The scheme the page shows now, for something drawn in it, such as a preview. */
export function useColourScheme(): ColourScheme {
  return useSyncExternalStore(subscribe, shownScheme);
}
