// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Keeps a signed-in respondent's draft saved as it changes, and says so. Saves
// a moment after the last change, when the page is hidden, when the
// connection returns and when the person moves on. A failed save leaves the
// answers on screen and tries again. What is typed and not yet saved is also
// kept by the host, so a session that ends does not lose it.

import { ProblemError } from '@pixel-scientists/domain/api';
import { validateAnswers } from '@pixel-scientists/domain/forms';
import type { Answers, FormDefinition } from '@pixel-scientists/domain/forms';
import { SaveStatus } from '@pixel-scientists/ui';
import type { SaveState } from '@pixel-scientists/ui';
import { useEffect, useRef, useState } from 'react';

import { withAnswer } from './helpers.ts';
import type { KeptDraft } from './host.tsx';
import type { AnswerStore } from './FormRunner.tsx';

export const SAVE_DELAY_MS = 1000;
const RETRY_DELAY_MS = 5000;

interface Options {
  definition: FormDefinition;
  kept: KeptDraft<Answers>;
  /** What is saved already, and when. */
  saved: { answers: Answers; at: Date | null };
  save: (answers: Answers) => Promise<void>;
}

/** The answers that can be saved now: one the engine refuses while the person is still typing is held back. */
function savable(definition: FormDefinition, answers: Answers): { body: Answers; held: number } {
  const refused = new Set(
    validateAnswers(definition, answers, 'draft').map(({ field }) => field.split('.')[0]),
  );
  return {
    body: Object.fromEntries(Object.entries(answers).filter(([id]) => !refused.has(id))),
    held: refused.size,
  };
}

export function useAutosave({ definition, kept, saved, save }: Options): AnswerStore {
  const [status, setStatus] = useState<SaveState>(
    saved.at === null ? { status: 'idle' } : { status: 'saved', at: saved.at },
  );
  const [held, setHeld] = useState(0);
  const latest = useRef(kept.values);
  const last = useRef(JSON.stringify(saved.answers));
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const queue = useRef(Promise.resolve(true));
  const closed = useRef(false);

  async function send(): Promise<boolean> {
    const sending = latest.current;
    const { body, held: refused } = savable(definition, sending);
    setHeld(refused);
    if (JSON.stringify(body) === last.current) {
      setStatus((now) => (now.status === 'saving' ? { status: 'saved', at: new Date() } : now));
      return refused === 0;
    }
    setStatus({ status: 'saving' });
    try {
      await save(body);
      last.current = JSON.stringify(body);
      if (latest.current === sending) {
        setStatus({ status: 'saved', at: new Date() });
        if (refused === 0) kept.discard();
      }
      return refused === 0;
    } catch (error) {
      setStatus({ status: 'failed' });
      const worthRetrying =
        error instanceof ProblemError &&
        (error.status === 0 || error.status >= 500 || error.status === 429);
      if (!closed.current && worthRetrying) {
        timer.current = setTimeout(() => {
          void flush();
        }, RETRY_DELAY_MS);
      }
      return false;
    }
  }

  function flush(): Promise<boolean> {
    clearTimeout(timer.current);
    queue.current = queue.current.then(send);
    return queue.current;
  }

  function change(fieldId: string, value: unknown) {
    const next = withAnswer(latest.current, fieldId, value);
    latest.current = next;
    kept.change(next);
    setStatus({ status: 'saving' });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void flush();
    }, SAVE_DELAY_MS);
  }

  const run = useRef(flush);
  useEffect(() => {
    run.current = flush;
  });
  useEffect(() => {
    const now = run;
    closed.current = false;
    if (kept.restored) void now.current();
    const whenHidden = () => {
      if (document.visibilityState === 'hidden') void now.current();
    };
    const whenOnline = () => void now.current();
    document.addEventListener('visibilitychange', whenHidden);
    window.addEventListener('online', whenOnline);
    return () => {
      document.removeEventListener('visibilitychange', whenHidden);
      window.removeEventListener('online', whenOnline);
      closed.current = true;
      clearTimeout(timer.current);
      void now.current();
    };
    // Set up once: the listeners reach the latest save through `run`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    answers: kept.values,
    change,
    status: (
      <>
        <SaveStatus state={status} />
        {held > 0 && (
          <p className="text-body font-medium text-danger">
            Some answers are not saved yet. Fix them to save them.
          </p>
        )}
      </>
    ),
    note: 'We save your answers as you type. You can leave at any time.',
    unsaved: status.status === 'failed' || held > 0,
    flush,
  };
}
