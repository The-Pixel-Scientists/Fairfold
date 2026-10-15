// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What a person has typed on a form and not yet saved is kept in this window,
// so leaving the page, or a session that ends, does not lose it. It is kept
// in memory only, under the signed-in address, and forgotten on sign-out.

import { useSession } from '@pixel-scientists/ui';
import { useState } from 'react';

const kept = new Map<string, unknown>();

export function forgetDrafts(): void {
  kept.clear();
}

export interface Draft<T> {
  values: T;
  change: (values: T) => void;
  /** True when the form opened with what the person had typed before, which is not what is saved. */
  restored: boolean;
  /** Call once the values are saved. */
  discard: () => void;
}

/**
 * The values of a form: what was kept for `form` if anything, else `saved`.
 * Every change is kept at once. The pages that use it sit inside a signed-in
 * Screen, so the session is ready.
 */
export function useDraft<T>(form: string, saved: T): Draft<T> {
  const { state } = useSession();
  const key = `${state.status === 'ready' ? state.session.user.email : ''}:${form}`;
  const [initial] = useState(() => kept.get(key) as T | undefined);
  const [values, setValues] = useState<T>(initial ?? saved);

  return {
    values,
    change(next) {
      kept.set(key, next);
      setValues(next);
    },
    restored: initial !== undefined && JSON.stringify(initial) !== JSON.stringify(saved),
    discard() {
      kept.delete(key);
    },
  };
}
