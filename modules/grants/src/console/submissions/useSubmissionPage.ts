// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A page of the list, read when the filters or page change. The last answer
// for each address is kept in memory, so going Back to a list shows its rows
// at once and the router can restore the scroll position before the fresh
// answer replaces them. The copy belongs to one membership and is dropped when
// the page is reloaded.

import { asProblem, useSession } from '@pixel-scientists/ui';
import type { Loaded } from '@pixel-scientists/ui';
import { useCallback, useEffect, useState } from 'react';

import type { SubmissionPage, SubmissionQuery } from '../../contracts/index.ts';
import { loadSubmissionPage } from './loaders.ts';
import { searchOf } from './query.ts';

const MAX_KEPT = 20;
const kept = new Map<string, SubmissionPage>();

function keep(key: string, page: SubmissionPage): void {
  kept.delete(key);
  kept.set(key, page);
  const [oldest] = kept.keys();
  if (kept.size > MAX_KEPT && oldest !== undefined) kept.delete(oldest);
}

/** Forget every kept page, such as after submissions have moved. */
export function forgetPages(): void {
  kept.clear();
}

export interface SubmissionPageState {
  state: Loaded<SubmissionPage>;
  /** Reads the page again. Rows on show stay until the fresh ones arrive. */
  reload: () => void;
}

/** Give it the query that useSearch returned, which stays the same object until the address changes. */
export function useSubmissionPage(query: SubmissionQuery): SubmissionPageState {
  const { state: session } = useSession();
  const membership = session.status === 'ready' ? session.session.activeMembership?.id : undefined;
  const key = `${membership ?? ''}${searchOf(query)}`;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; state: Loaded<SubmissionPage> } | null>(null);

  useEffect(() => {
    let current = true;
    loadSubmissionPage(query).then(
      (page) => {
        keep(key, page);
        if (current) setResult({ key, state: { status: 'ready', value: page } });
      },
      (error: unknown) => {
        const message = asProblem(error)?.detail ?? 'Something went wrong. Try again.';
        if (current) setResult({ key, state: { status: 'failed', message } });
      },
    );
    return () => {
      current = false;
    };
  }, [query, key, attempt]);

  const reload = useCallback(() => {
    forgetPages();
    // Rows already on show stay until the fresh answer replaces them; a failure gives way to loading.
    setResult((previous) => (previous?.state.status === 'failed' ? null : previous));
    setAttempt((count) => count + 1);
  }, []);

  const earlier = kept.get(key);
  const state: Loaded<SubmissionPage> =
    result?.key === key
      ? result.state
      : earlier === undefined
        ? { status: 'loading' }
        : { status: 'ready', value: earlier };
  return { state, reload };
}
