// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The reviewer's scores while they work: held on the page, and saved to the
// server a moment after each change. One save runs at a time, and a change
// made during one is saved when it ends, so the server always ends up with
// the latest entries. A failed save is tried again on the next change, or
// when the reviewer asks.

import type { SaveState } from '@pixel-scientists/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { Criterion } from '../../contracts/index.ts';
import { saveScores } from './loaders.ts';
import { toInput } from './scoring.ts';
import type { Entries, Entry } from './scoring.ts';

/** How long after the last change the scores are saved. */
export const SAVE_DELAY = 800;

export interface ReviewScores {
  entries: Entries;
  save: SaveState;
  /** Whether what is on the page differs from what the server holds. */
  unsaved: boolean;
  change: (criterionId: string, entry: Entry) => void;
  /** Saves now, and says whether the server holds every change. */
  saveNow: () => Promise<boolean>;
}

export function useReviewScores(
  assignmentId: string,
  criteria: readonly Criterion[],
  initial: Entries,
): ReviewScores {
  const bodyOf = useCallback(
    (entries: Entries) => JSON.stringify(toInput(criteria, entries)),
    [criteria],
  );
  const [entries, setEntries] = useState(initial);
  const [save, setSave] = useState<SaveState>({ status: 'idle' });
  const [held, setHeld] = useState(() => bodyOf(initial));
  const latest = useRef(entries);
  const heldBody = useRef(held);
  const timer = useRef<number | undefined>(undefined);
  /** Saves wait their turn, so only one is on its way at a time. */
  const queue = useRef<Promise<boolean>>(Promise.resolve(true));

  const saveNow = useCallback((): Promise<boolean> => {
    window.clearTimeout(timer.current);
    const next = queue.current.then(async () => {
      const body = bodyOf(latest.current);
      if (body === heldBody.current) return true;
      setSave({ status: 'saving' });
      try {
        await saveScores(assignmentId, toInput(criteria, latest.current));
      } catch {
        setSave({ status: 'failed' });
        return false;
      }
      heldBody.current = body;
      setHeld(body);
      // A change made while this was saving is saved when the next in the queue runs.
      if (bodyOf(latest.current) === body) setSave({ status: 'saved', at: new Date() });
      return true;
    });
    queue.current = next;
    return next;
  }, [assignmentId, criteria, bodyOf]);

  const change = useCallback(
    (criterionId: string, entry: Entry) => {
      const next = { ...latest.current, [criterionId]: entry };
      latest.current = next;
      setEntries(next);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        void saveNow();
      }, SAVE_DELAY);
    },
    [saveNow],
  );

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
    },
    [],
  );

  return { entries, save, unsaved: bodyOf(entries) !== held, change, saveNow };
}
