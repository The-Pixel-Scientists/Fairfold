// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Releasing decisions and sending their emails need a recent sign-in (ADR
// 0010). This asks the person to confirm it is them, and carries on.

import { call, ProblemError } from '@pixel-scientists/domain/api';
import { stepUp } from '@pixel-scientists/domain/auth';
import { StepUpDialog, useSession } from '@pixel-scientists/ui';
import type { SessionData, StepUpCredentials } from '@pixel-scientists/ui';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';

/** What the API says when an action needs a recent sign-in. It has no code of its own to match. */
export const STEP_UP_NEEDED = 'Confirm it is you again, then try again.';

export const STEP_UP_FAILED = 'Your password or code is not right. Check them and try again.';

export const needsStepUp = (error: unknown): boolean =>
  error instanceof ProblemError && error.status === 403 && error.detail === STEP_UP_NEEDED;

/** A refused password or code gets one message, so nothing says which part was wrong. */
export async function confirmItsYou(
  credentials: StepUpCredentials,
  setSession: (session: SessionData) => void,
): Promise<void> {
  try {
    setSession(await call(stepUp, { body: credentials }));
  } catch (error) {
    if (error instanceof ProblemError && (error.status === 401 || error.status === 403)) {
      throw new ProblemError(error.status, STEP_UP_FAILED);
    }
    throw error;
  }
}

export interface StepUp {
  /** Asks the person to confirm it is them. True once they have, false if they cancel. */
  ask: () => Promise<boolean>;
  /**
   * Runs the action. If the API says it needs a recent sign-in, asks first and
   * runs it once more. Gives `null` when the person cancels instead. Any other
   * failure, or a second refusal, is thrown.
   */
  run: <T>(action: () => Promise<T>) => Promise<T | null>;
  /** Put this in the page. */
  dialog: ReactNode;
}

export function useStepUp(): StepUp {
  const { setSession } = useSession();
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

  return { ask, run, dialog };
}
