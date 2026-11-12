// SPDX-License-Identifier: AGPL-3.0-or-later

import { ProblemError } from '@pixel-scientists/domain/api';
import { StepUpDialog, useSession } from '@pixel-scientists/ui';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { confirmItsYou } from '../../auth/stepUp.ts';
import { STEP_UP_NEEDED, needsStepUp } from './change.ts';

export interface StepUp {
  /**
   * Runs the action. If the API says it needs a recent sign-in, asks the
   * person to confirm it is them and runs it once more. Gives `null` when
   * they cancel instead. Any other failure, or a second refusal, is thrown.
   */
  run: <T>(action: () => Promise<T>) => Promise<T | null>;
  /**
   * Asks to confirm it is them before a form opens, unless they did recently,
   * so nothing typed is lost to it. False when they cancel.
   */
  ensure: () => Promise<boolean>;
  /** True while the person is being asked, so a dialog behind it can step aside. */
  asking: boolean;
  /** Put this in the page. */
  dialog: ReactNode;
}

export function useStepUp(): StepUp {
  const { state, setSession } = useSession();
  const [answer, setAnswer] = useState<((confirmed: boolean) => void) | null>(null);
  const confirmed = useRef(false);

  const ask = () =>
    new Promise<boolean>((resolve) => {
      confirmed.current = false;
      setAnswer(() => resolve);
    });

  async function run<T>(action: () => Promise<T>): Promise<T | null> {
    try {
      return await action();
    } catch (error) {
      if (!needsStepUp(error)) throw error;
    }
    return (await ask()) ? action() : null;
  }

  async function ensure(): Promise<boolean> {
    const until = state.status === 'ready' ? (state.session.recentAuthUntil ?? null) : null;
    let checked = until !== null && Date.parse(until) > Date.now();
    const done = await run(() => {
      if (checked) return Promise.resolve(true);
      checked = true;
      return Promise.reject(new ProblemError(403, STEP_UP_NEEDED));
    });
    return done === true;
  }

  const dialog = (
    <StepUpDialog
      open={answer !== null}
      onOpenChange={(open) => {
        if (open) return;
        answer?.(confirmed.current);
        setAnswer(null);
      }}
      onConfirm={async (credentials) => {
        await confirmItsYou(credentials, setSession);
        confirmed.current = true;
      }}
    />
  );

  return { run, ensure, asking: answer !== null, dialog };
}
