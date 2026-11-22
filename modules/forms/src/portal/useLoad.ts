// SPDX-License-Identifier: AGPL-3.0-or-later

import { ProblemError } from '@pixel-scientists/domain/api';
import { useCallback, useEffect, useRef, useState } from 'react';

export type Load<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  /** The API answers 404 for anything it will not show, so a page cannot tell why. */
  | { status: 'missing' }
  | { status: 'failed' };

/** Reads when the page opens and when `key` changes, and again on `retry`. A read for an older key is never shown. */
export function useLoad<T>(
  read: () => Promise<T>,
  key: string,
): { load: Load<T>; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; load: Load<T> }>({
    key: '',
    load: { status: 'loading' },
  });
  const latest = useRef(read);
  useEffect(() => {
    latest.current = read;
  });
  const current = `${key}#${String(attempt)}`;

  useEffect(() => {
    let live = true;
    latest.current().then(
      (data) => {
        if (live) setState({ key: current, load: { status: 'ready', data } });
      },
      (error: unknown) => {
        if (live) {
          const missing = error instanceof ProblemError && error.status === 404;
          setState({ key: current, load: { status: missing ? 'missing' : 'failed' } });
        }
      },
    );
    return () => {
      live = false;
    };
  }, [current]);

  const retry = useCallback(() => {
    setAttempt((count) => count + 1);
  }, []);

  return { load: state.key === current ? state.load : { status: 'loading' }, retry };
}
