// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { asProblem } from '../auth/problems.ts';
import { Button } from '../Button.tsx';
import { EmptyState } from '../EmptyState.tsx';
import { LoadingState } from '../LoadingState.tsx';

export type Loaded<T> =
  { status: 'loading' } | { status: 'failed'; message: string } | { status: 'ready'; value: T };

export interface UseLoad<T> {
  state: Loaded<T>;
  /** Reads it again from the start, showing the loading state. */
  retry: () => void;
}

const UNEXPECTED = 'Something went wrong. Try again.';

/**
 * Reads something from the API when the page opens: loading, then the value
 * or the words for why it did not come. A failed API call carries its own
 * words. Define `load` once, outside any component, and give it the `key`
 * (such as an id) it reads by; the value is read again only when either changes.
 */
export function useLoad<T>(load: () => Promise<T>): UseLoad<T>;
export function useLoad<T, K>(load: (key: K) => Promise<T>, key: K): UseLoad<T>;
export function useLoad<T, K>(load: (key?: K) => Promise<T>, key?: K): UseLoad<T> {
  const [state, setState] = useState<Loaded<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    load(key).then(
      (value) => {
        if (current) setState({ status: 'ready', value });
      },
      (error: unknown) => {
        if (current)
          setState({ status: 'failed', message: asProblem(error)?.detail ?? UNEXPECTED });
      },
    );
    return () => {
      current = false;
    };
  }, [load, key, attempt]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((count) => count + 1);
  }, []);

  return { state, retry };
}

export interface WhenLoadedProps<T> {
  state: Loaded<T>;
  /** Says what is loading, such as "Loading programmes". */
  label: string;
  retry: () => void;
  /** The page once it is ready. */
  children: (value: T) => ReactNode;
}

/** Shows what useLoad has: the loading state, why it failed with a way to try again, or the page. */
export function WhenLoaded<T>({ state, label, retry, children }: WhenLoadedProps<T>) {
  if (state.status === 'loading') {
    return <LoadingState label={label} className="rounded-lg bg-surface" />;
  }
  if (state.status === 'failed') {
    return (
      <EmptyState
        title="We could not load this page"
        action={<Button onClick={retry}>Try again</Button>}
      >
        <p>{state.message}</p>
      </EmptyState>
    );
  }
  return children(state.value);
}
