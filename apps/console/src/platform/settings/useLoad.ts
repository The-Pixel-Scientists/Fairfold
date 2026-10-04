// SPDX-License-Identifier: AGPL-3.0-or-later

import { messages } from '@pixel-scientists/domain/platform';
import { asProblem } from '@pixel-scientists/ui';
import { useCallback, useEffect, useState } from 'react';

export type Loaded<T> =
  { status: 'loading' } | { status: 'failed'; message: string } | { status: 'ready'; value: T };

/**
 * Reads something from the API when the page opens: loading, then the value
 * or the words for why it did not come. `retry` reads it again from the
 * start. Pass a function that is defined once, outside any component.
 */
export function useLoad<T>(load: () => Promise<T>): { state: Loaded<T>; retry: () => void } {
  const [state, setState] = useState<Loaded<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    load().then(
      (value) => {
        if (current) setState({ status: 'ready', value });
      },
      (error: unknown) => {
        if (current) {
          setState({
            status: 'failed',
            message: asProblem(error)?.detail ?? messages.serviceFailed,
          });
        }
      },
    );
    return () => {
      current = false;
    };
  }, [load, attempt]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((count) => count + 1);
  }, []);

  return { state, retry };
}
