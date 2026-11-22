// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A list read a page at a time: the first page when it opens or its key
// changes, then more on request.

import { asProblem } from '@pixel-scientists/ui';
import { useCallback, useEffect, useState } from 'react';

export interface Page<T> {
  items: readonly T[];
  nextCursor: string | null;
}

export interface Paged<T> {
  status: 'loading' | 'failed' | 'ready';
  message: string;
  items: readonly T[];
  hasMore: boolean;
  loadingMore: boolean;
  /** Why the last "show more" failed, or null. */
  moreProblem: string | null;
  more: () => void;
  retry: () => void;
  remove: (gone: (item: T) => boolean) => void;
}

const UNEXPECTED = 'Something went wrong. Try again.';

interface State<T, K> {
  /** The key the rows were read for; rows read for another key are not shown. */
  for: K | undefined;
  status: Paged<T>['status'];
  message: string;
  items: readonly T[];
  next: string | null;
}

/**
 * Define `load` once, outside the component, and give it the `key` it reads
 * by. The key may hold filters: it stays in memory and never reaches an address.
 */
export function usePaged<T, K>(
  load: (key: K, cursor?: string) => Promise<Page<T>>,
  key: K,
): Paged<T> {
  const loading: State<T, K> = {
    for: undefined,
    status: 'loading',
    message: '',
    items: [],
    next: null,
  };
  const [read, setRead] = useState<State<T, K>>(loading);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreProblem, setMoreProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const state = read.for === key ? read : loading;

  useEffect(() => {
    let current = true;
    load(key).then(
      (page) => {
        if (current) {
          setRead({
            for: key,
            status: 'ready',
            message: '',
            items: page.items,
            next: page.nextCursor,
          });
        }
      },
      (error: unknown) => {
        if (current) {
          setRead({
            for: key,
            status: 'failed',
            message: asProblem(error)?.detail ?? UNEXPECTED,
            items: [],
            next: null,
          });
        }
      },
    );
    return () => {
      current = false;
    };
  }, [load, key, attempt]);

  const more = useCallback(() => {
    if (state.next === null || loadingMore) return;
    setLoadingMore(true);
    load(key, state.next).then(
      (page) => {
        setRead((now) => ({ ...now, items: [...now.items, ...page.items], next: page.nextCursor }));
        setMoreProblem(null);
        setLoadingMore(false);
      },
      (error: unknown) => {
        setMoreProblem(asProblem(error)?.detail ?? UNEXPECTED);
        setLoadingMore(false);
      },
    );
  }, [load, key, state.next, loadingMore]);

  const retry = useCallback(() => {
    setRead({ for: undefined, status: 'loading', message: '', items: [], next: null });
    setAttempt((count) => count + 1);
  }, []);

  const remove = useCallback((gone: (item: T) => boolean) => {
    setRead((now) => ({ ...now, items: now.items.filter((item) => !gone(item)) }));
  }, []);

  return {
    status: state.status,
    message: state.message,
    items: state.items,
    hasMore: state.next !== null,
    loadingMore,
    moreProblem,
    more,
    retry,
    remove,
  };
}
