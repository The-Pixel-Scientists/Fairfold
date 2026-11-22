// SPDX-License-Identifier: AGPL-3.0-or-later

import { ProblemError } from '@pixel-scientists/domain/api';
import { asProblem } from '@pixel-scientists/ui';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

const UNEXPECTED = 'Something went wrong. Try again.';

export type Read<T> =
  | { status: 'loading' }
  | { status: 'notFound' }
  | { status: 'failed'; message: string }
  | { status: 'ready'; value: T };

/** A 403 or 404 reads the same, so nothing says whether a record exists. */
const hidden = (error: unknown): boolean =>
  error instanceof ProblemError && (error.status === 403 || error.status === 404);

const failure = (error: unknown): Read<never> =>
  hidden(error)
    ? { status: 'notFound' }
    : { status: 'failed', message: asProblem(error)?.detail ?? UNEXPECTED };

const LOADING: Read<never> = { status: 'loading' };

export interface UseRead<T> {
  state: Read<T>;
  /** Reads again, showing the loading state. */
  reload: () => void;
  /** Puts in a newer value that an action's answer carried, without reading again. */
  set: (value: T) => void;
}

/**
 * What was read, and for which key and attempt. A read for another key or
 * attempt is not shown, so the loading state comes back without a state
 * change inside an effect.
 */
interface Held<T, K> {
  key: K;
  attempt: number;
  read: Read<T>;
}

/**
 * Reads from the API when the page opens, and again when `key` changes. Define
 * `load` once, outside any component.
 */
export function useRead<T>(load: () => Promise<T>): UseRead<T>;
export function useRead<T, K>(load: (key: K) => Promise<T>, key: K): UseRead<T>;
export function useRead<T, K>(load: (key?: K) => Promise<T>, key?: K): UseRead<T> {
  const [held, setHeld] = useState<Held<T, K | undefined> | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    load(key).then(
      (value) => {
        if (current) setHeld({ key, attempt, read: { status: 'ready', value } });
      },
      (error: unknown) => {
        if (current) setHeld({ key, attempt, read: failure(error) });
      },
    );
    return () => {
      current = false;
    };
  }, [load, key, attempt]);
  const reload = useCallback(() => {
    setAttempt((count) => count + 1);
  }, []);
  const set = useCallback(
    (value: T) => {
      setHeld({ key, attempt, read: { status: 'ready', value } });
    },
    [key, attempt],
  );
  const state = held !== null && held.key === key && held.attempt === attempt ? held.read : LOADING;
  return { state, reload, set };
}

const EVERY_MS = 3000;

/** Reads a job's status, and again every few seconds until `finished` says it is final. */
export function usePolled<T>(read: () => Promise<T>, finished: (value: T) => boolean): Read<T> {
  const [state, setState] = useState<Read<T>>(LOADING);
  const latest = useRef({ read, finished });
  useEffect(() => {
    latest.current = { read, finished };
  });
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      latest.current.read().then(
        (value) => {
          if (!live) return;
          setState({ status: 'ready', value });
          if (!latest.current.finished(value)) timer = setTimeout(tick, EVERY_MS);
        },
        (error: unknown) => {
          if (live) setState(failure(error));
        },
      );
    };
    tick();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, []);
  return state;
}

export interface Page<T> {
  items: readonly T[];
  next: string | null;
}

export interface UsePages<T> {
  state: Read<Page<T>>;
  /** True while the next page loads. */
  loadingMore: boolean;
  /** Why the next page did not load, or null. */
  moreFailed: string | null;
  more: () => void;
  reload: () => void;
}

/** A list read a page at a time. Reads again from the start when `key` changes. */
export function usePages<T>(
  load: (cursor: string | undefined) => Promise<Page<T>>,
  key: string,
): UsePages<T> {
  const latest = useRef(load);
  useEffect(() => {
    latest.current = load;
  });
  const [held, setHeld] = useState<Held<Page<T>, string> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    latest.current(undefined).then(
      (value) => {
        if (current) setHeld({ key, attempt, read: { status: 'ready', value } });
      },
      (error: unknown) => {
        if (current) setHeld({ key, attempt, read: failure(error) });
      },
    );
    return () => {
      current = false;
    };
  }, [key, attempt]);
  const state = held !== null && held.key === key && held.attempt === attempt ? held.read : LOADING;

  const more = useCallback(() => {
    if (state.status !== 'ready' || state.value.next === null || loadingMore) return;
    const { items, next } = state.value;
    setLoadingMore(true);
    setMoreFailed(null);
    latest
      .current(next)
      .then(
        (page) => {
          setHeld({
            key,
            attempt,
            read: { status: 'ready', value: { items: [...items, ...page.items], next: page.next } },
          });
        },
        (error: unknown) => {
          setMoreFailed(asProblem(error)?.detail ?? UNEXPECTED);
        },
      )
      .finally(() => {
        setLoadingMore(false);
      });
  }, [state, loadingMore, key, attempt]);
  const reload = useCallback(() => {
    setMoreFailed(null);
    setAttempt((count) => count + 1);
  }, []);
  return { state, loadingMore, moreFailed, more, reload };
}

/** The current time, read again every minute. It is not a live region, so nothing is announced on each tick. */
export function useNow(): string {
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date().toISOString());
    }, 60_000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return now;
}

export const ZoneContext = createContext('Europe/London');

/** The funder's time zone, which every date and deadline here is shown in. */
export const useZone = (): string => useContext(ZoneContext);

/**
 * Sends an action under one idempotency key, and keeps the key when the
 * answer was lost, so trying again cannot do it twice.
 */
export function useOnce() {
  const key = useRef<string | undefined>(undefined);
  return async function once<T>(
    action: (idempotencyKey: string | undefined) => Promise<T>,
  ): Promise<T> {
    try {
      const result = await action(key.current);
      key.current = undefined;
      return result;
    } catch (error) {
      const lost = error instanceof ProblemError && (error.status === 0 || error.status >= 500);
      key.current = lost && error.idempotencyKey !== null ? error.idempotencyKey : undefined;
      throw error;
    }
  };
}

/** Tells the privacy screen whether the page has unsaved changes, so a link inside the tool asks first. */
export const UnsavedContext = createContext<(unsaved: boolean) => void>(() => undefined);
