// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Lists that load a page at a time, and filters, kept in memory only so that
// going back to a list shows it as it was left (ADR 0018). Nothing here goes
// in an address, history state or storage: a filter or a row can name people.

import { asProblem } from '@pixel-scientists/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

const remembered = new Map<string, unknown>();

/** Forgets everything remembered, as signing out or a test does. */
export function forgetPages(): void {
  remembered.clear();
}

/** State that the next visit to the page starts from. */
export function useRemembered<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, set] = useState<T>(() => (remembered.get(key) as T | undefined) ?? initial);
  return [
    value,
    (next) => {
      remembered.set(key, next);
      set(next);
    },
  ];
}

export interface Page<T> {
  items: readonly T[];
  next: string | null;
}

export type Pages<T> =
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | {
      status: 'ready';
      items: readonly T[];
      next: string | null;
      /** Whether the next page is loading, or could not be read. */
      more: 'idle' | 'loading' | 'failed';
      /** How many rows the last "show more" added, for the live region. */
      added: number;
    };

const UNEXPECTED = 'Something went wrong. Try again.';

/**
 * Reads the first page, then the next on request. Give the list a `key` in
 * the parent that changes with the filters, so a new filter starts again.
 */
export function usePages<T>(memoryKey: string, read: (cursor: string | null) => Promise<Page<T>>) {
  const [state, setState] = useState<Pages<T>>(
    () => (remembered.get(memoryKey) as Pages<T> | undefined) ?? { status: 'loading' },
  );
  const reading = useRef(read);
  useEffect(() => {
    reading.current = read;
  });

  const read1 = useCallback(() => {
    reading.current(null).then(
      (page) => {
        setState({ status: 'ready', ...page, more: 'idle', added: 0 });
      },
      (error: unknown) => {
        setState({ status: 'failed', message: asProblem(error)?.detail ?? UNEXPECTED });
      },
    );
  }, []);

  useEffect(() => {
    // Only the first visit reads: a remembered list is shown as it was.
    if (remembered.get(memoryKey) === undefined) read1();
  }, [memoryKey, read1]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    read1();
  }, [read1]);

  useEffect(() => {
    if (state.status === 'ready') remembered.set(memoryKey, { ...state, more: 'idle', added: 0 });
  }, [memoryKey, state]);

  function more() {
    if (state.status !== 'ready' || state.next === null || state.more === 'loading') return;
    setState({ ...state, more: 'loading' });
    reading.current(state.next).then(
      (page) => {
        setState({
          status: 'ready',
          items: [...state.items, ...page.items],
          next: page.next,
          more: 'idle',
          added: page.items.length,
        });
      },
      () => {
        setState({ ...state, more: 'failed' });
      },
    );
  }

  /** Replaces one row, such as a response just marked as spam. */
  function replace(match: (item: T) => boolean, item: T) {
    setState((current) =>
      current.status === 'ready'
        ? { ...current, items: current.items.map((one) => (match(one) ? item : one)) }
        : current,
    );
  }

  return { state, retry, more, replace };
}
