// SPDX-License-Identifier: AGPL-3.0-or-later

import { ProblemError } from '@pixel-scientists/domain/api';
import { useCallback, useEffect, useState } from 'react';

export type Read<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  /** `missing` when the API says the record is not there, or is not the person's. */
  | { status: 'failed'; missing: boolean };

/**
 * Reads something from the API when the page opens, and again on `retry`.
 * Define `read` outside the component, or wrap it in `useCallback`: it runs
 * again whenever it changes.
 */
export function useRead<T>(read: () => Promise<T>): { read: Read<T>; retry: () => void } {
  const [state, setState] = useState<Read<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    read().then(
      (data) => {
        if (current) setState({ status: 'ready', data });
      },
      (error: unknown) => {
        if (current) {
          setState({
            status: 'failed',
            missing: error instanceof ProblemError && error.status === 404,
          });
        }
      },
    );
    return () => {
      current = false;
    };
  }, [read, attempt]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((count) => count + 1);
  }, []);

  return { read: state, retry };
}
