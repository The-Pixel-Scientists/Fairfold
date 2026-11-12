// SPDX-License-Identifier: AGPL-3.0-or-later

import { idSchema } from '@pixel-scientists/domain';
import { ProblemError } from '@pixel-scientists/domain/api';
import { messages } from '@pixel-scientists/domain/platform';
import { PageHeading, Link, asProblem, buttonClassName, useParams } from '@pixel-scientists/ui';
import { useCallback, useEffect, useState } from 'react';

import { SUBJECT_ACCESS_PATH } from './paths.ts';

/** One screen for every 404, so it says nothing about whose request or person it was. */
export function NotFound() {
  return (
    <div className="flex max-w-3xl flex-col items-start gap-4">
      <PageHeading>Not found</PageHeading>
      <p className="max-w-prose text-body text-muted">
        There is nothing at this address, or you cannot see it. Go back and find the person again.
      </p>
      <Link to={SUBJECT_ACCESS_PATH} className={buttonClassName('primary')}>
        Find a person
      </Link>
    </div>
  );
}

export const isNotFound = (error: unknown): boolean =>
  error instanceof ProblemError && error.status === 404;

/** A path parameter that is an id, or null: anything else is not found. */
export function useIdParam(name: string): string | null {
  const parsed = idSchema.safeParse(useParams()[name]);
  return parsed.success ? parsed.data : null;
}

export type Polled<T> =
  | { status: 'loading' }
  | { status: 'notFound' }
  | { status: 'failed'; message: string }
  /** `changed` is true when this read moved a request that was still going to its final state. */
  | { status: 'ready'; value: T; changed: boolean };

const EVERY_MS = 3000;

/**
 * Reads a request's status, and again every few seconds until `finished`
 * says it is final. It waits while the page is hidden and stops when the
 * page is left.
 */
export function usePolled<T>(
  read: () => Promise<T>,
  finished: (value: T) => boolean,
): { state: Polled<T>; retry: () => void } {
  const [state, setState] = useState<Polled<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let paused = false;

    const tick = async () => {
      try {
        const value = await read();
        if (!live) return;
        setState((previous) => ({
          status: 'ready',
          value,
          changed: previous.status === 'ready' && !finished(previous.value) && finished(value),
        }));
        if (!finished(value)) timer = setTimeout(wake, EVERY_MS);
      } catch (error) {
        if (!live) return;
        setState(
          isNotFound(error)
            ? { status: 'notFound' }
            : { status: 'failed', message: asProblem(error)?.detail ?? messages.serviceFailed },
        );
      }
    };
    const wake = () => {
      if (document.hidden) paused = true;
      else void tick();
    };
    const onVisible = () => {
      if (paused && !document.hidden) {
        paused = false;
        void tick();
      }
    };

    document.addEventListener('visibilitychange', onVisible);
    void tick();
    return () => {
      live = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [read, finished, attempt]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((count) => count + 1);
  }, []);

  return { state, retry };
}
