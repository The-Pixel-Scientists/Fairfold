// SPDX-License-Identifier: AGPL-3.0-or-later

import { asProblem, Notice, useSession } from '@pixel-scientists/ui';
import { useEffect, useReducer, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { useStepUp } from '../decisions/useStepUp.tsx';
import { endedText, ExportStatus } from './ExportStatus.tsx';
import { dropJob, heldJob, holdJob, isFinished, nextDelay, readJob, words } from './jobs.ts';
import type { ExportKind, JobRequest } from './jobs.ts';

const UNEXPECTED = 'Something went wrong. Try again.';

export interface Export {
  /** Starts the job with `begin`, which is given the one key for this action. Ignored while one is starting. */
  start: (begin: (key: string) => Promise<{ requestId: string }>) => Promise<void>;
  starting: boolean;
  /** Put this in the page: the live region, the job's state, a refusal and the step-up dialog. */
  panel: ReactNode;
}

/**
 * Starts an export and follows it with the requester-scoped status route,
 * reading less often the longer it takes. It stops when the job ends, the
 * page is left or the session ends. A 403 or 404 from any route is shown
 * once as the server's words, never retried.
 */
export function useExport(kind: ExportKind): Export {
  const { state } = useSession();
  /** Whose jobs these are: this person, working for this funder. A new session starts empty. */
  const userId =
    state.status === 'ready' && state.session.activeMembership !== null
      ? `${state.session.user.email}|${state.session.activeMembership.id}`
      : null;
  const stepUp = useStepUp();
  const busy = useRef(false);
  const [starting, setStarting] = useState(false);
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const requestId = userId === null ? undefined : heldJob(userId, kind);
  const [job, setJob] = useState<JobRequest | null>(null);
  const [refusal, setRefusal] = useState('');
  const [heard, setHeard] = useState('');

  useEffect(() => {
    if (requestId === undefined || userId === null) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay: number | null = null;
    let last: JobRequest['status'] | undefined;

    const read = async () => {
      try {
        const next = await readJob[kind](requestId);
        if (!live) return;
        setJob(next);
        const ended = last === next.status ? null : endedText(kind, next);
        if (last !== undefined && ended !== null) setHeard(ended);
        last = next.status;
        if (!isFinished(next)) {
          delay = nextDelay(delay);
          timer = setTimeout(() => void read(), delay);
        }
      } catch (error) {
        if (!live) return;
        dropJob(userId, kind);
        rerender();
        setRefusal(asProblem(error)?.detail ?? UNEXPECTED);
      }
    };
    void read();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [requestId, userId, kind]);

  async function start(begin: (key: string) => Promise<{ requestId: string }>) {
    if (busy.current || userId === null) return;
    busy.current = true;
    setStarting(true);
    setRefusal('');
    const key = crypto.randomUUID();
    try {
      const accepted = await stepUp.run(() => begin(key));
      if (accepted === null) return;
      holdJob(userId, kind, accepted.requestId);
      setJob(null);
      rerender();
      setHeard(words[kind].started);
    } catch (error) {
      setRefusal(asProblem(error)?.detail ?? UNEXPECTED);
    } finally {
      busy.current = false;
      setStarting(false);
    }
  }

  const panel = (
    <>
      <p role="status" className="sr-only">
        {heard}
      </p>
      {refusal !== '' && (
        <div role="alert">
          <Notice tone="danger" title={`The ${words[kind].noun} did not go through`}>
            {refusal}
          </Notice>
        </div>
      )}
      {requestId !== undefined && <ExportStatus kind={kind} job={job} />}
      {stepUp.dialog}
    </>
  );

  return { start, starting, panel };
}
