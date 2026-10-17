// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Keeps an application's answers saved as they change (docs/UI-REFERENCE.md,
// autosave that says so). Answers are saved a moment after the last change, when
// the page is left or hidden, and on demand. A failed save leaves the answers on
// screen and tries again. A save based on old answers is refused with a 409:
// saving stops until the person chooses to load the latest answers.
//
// What is typed and not yet saved is also kept in this window (party/drafts.ts),
// so a session that ends does not lose it.

import { ProblemError } from '@pixel-scientists/domain/api';
import type { Answers } from '@pixel-scientists/domain/forms';
import { saveApplicationAnswers } from '@pixel-scientists/grants/contracts';
import type { Application } from '@pixel-scientists/grants/contracts';
import type { SaveState } from '@pixel-scientists/ui';
import { useEffect, useRef, useState } from 'react';

import { callApi } from '../api.ts';
import { useDraft } from '../party/drafts.ts';
import { savable } from './form.ts';
import { trackSave } from './reads.ts';

/** How long after the last change the answers are saved. */
export const SAVE_DELAY_MS = 1000;
/** How long to wait before each new try after a failed save; the last is kept. */
export const RETRY_DELAYS_MS = [3000, 10_000, 30_000];

export interface Autosave {
  /** What is on screen, saved or not. */
  answers: Answers;
  /** Called with a question's id and its new answer, or null when the person clears it. */
  change: (fieldId: string, value: unknown) => void;
  status: SaveState;
  /** The server holds newer answers than the page was built on, so nothing more is saved. */
  stale: boolean;
  /** The page opened with what was typed before, and is saving it. */
  restored: boolean;
  /** Questions whose answers cannot be saved until they are fixed. */
  held: readonly string[];
  /** Saves now. Resolves true once everything that can be saved is saved. */
  save: () => Promise<boolean>;
  /** Forgets what was typed here, before the page loads the latest answers. */
  forget: () => void;
}

/** Whether a failed save is worth trying again: the API was out of reach or too busy. */
function worthRetrying(error: unknown): boolean {
  return (
    error instanceof ProblemError &&
    (error.status === 0 || error.status === 429 || error.status >= 500)
  );
}

export function useAutosave(application: Application): Autosave {
  const { id, form } = application;
  const { definition } = form;
  const draft = useDraft<Answers>(`application:${id}`, application.answers);
  const [status, setStatus] = useState<SaveState>({
    status: 'saved',
    at: new Date(application.updatedAt),
  });
  const [stale, setStale] = useState(false);
  const [held, setHeld] = useState<readonly string[]>([]);

  const latest = useRef(draft.values);
  const saved = useRef({
    answers: savable(definition, application.answers, {}).body,
    version: application.answersVersion,
    at: new Date(application.updatedAt),
  });
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const failures = useRef(0);
  const blocked = useRef(false);
  const closed = useRef(false);
  const queue = useRef(Promise.resolve(true));
  const discard = draft.discard;

  /** One save at a time, so each is based on the version the last one made. Never rejects. */
  async function send(): Promise<boolean> {
    if (blocked.current) return false;
    const sending = latest.current;
    const { body, held: notSaved } = savable(definition, sending, saved.current.answers);
    setHeld(notSaved);
    if (JSON.stringify(body) === JSON.stringify(saved.current.answers)) {
      setStatus({ status: 'saved', at: saved.current.at });
      return true;
    }
    setStatus({ status: 'saving' });
    try {
      const result = await callApi(saveApplicationAnswers, {
        params: { applicationId: id },
        body: { basedOn: saved.current.version, answers: body },
      });
      saved.current = {
        answers: body,
        version: result.answersVersion,
        at: new Date(result.updatedAt),
      };
      failures.current = 0;
      // Changes made while this was on its way are still to be saved.
      if (latest.current === sending) {
        setStatus({ status: 'saved', at: saved.current.at });
        if (notSaved.length === 0) discard();
      }
      return true;
    } catch (error) {
      if (error instanceof ProblemError && error.status === 409) {
        blocked.current = true;
        setStale(true);
        setStatus({ status: 'idle' });
        return false;
      }
      setStatus({ status: 'failed' });
      if (!closed.current && worthRetrying(error)) {
        const wait = RETRY_DELAYS_MS[Math.min(failures.current, RETRY_DELAYS_MS.length - 1)];
        failures.current += 1;
        timer.current = setTimeout(() => {
          void save();
        }, wait);
      }
      return false;
    }
  }

  function save(): Promise<boolean> {
    clearTimeout(timer.current);
    queue.current = queue.current.then(send);
    return trackSave(id, queue.current);
  }

  function change(fieldId: string, value: unknown) {
    const next = { ...latest.current, [fieldId]: value };
    latest.current = next;
    draft.change(next);
    if (!blocked.current) setStatus({ status: 'saving' });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void save();
    }, SAVE_DELAY_MS);
  }

  // The latest save, for the listeners below, which are set up once.
  const flush = useRef(save);
  useEffect(() => {
    flush.current = save;
  });

  useEffect(() => {
    const run = flush;
    closed.current = false;
    if (draft.restored) void run.current();
    function saveWhenHidden() {
      if (document.visibilityState === 'hidden') void run.current();
    }
    function saveWhenOnline() {
      void run.current();
    }
    document.addEventListener('visibilitychange', saveWhenHidden);
    window.addEventListener('online', saveWhenOnline);
    return () => {
      document.removeEventListener('visibilitychange', saveWhenHidden);
      window.removeEventListener('online', saveWhenOnline);
      closed.current = true;
      void run.current();
    };
  }, [draft.restored]);

  return {
    answers: draft.values,
    change,
    status,
    stale,
    restored: draft.restored,
    held,
    save,
    forget: discard,
  };
}
