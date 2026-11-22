// SPDX-License-Identifier: AGPL-3.0-or-later

import { call, ProblemError } from '@pixel-scientists/domain/api';
import { stepUp } from '@pixel-scientists/domain/auth';
import { StepUpDialog, useSession } from '@pixel-scientists/ui';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';

/** What the API says when an action needs a recent sign-in. It has no code of its own to match. */
const STEP_UP_NEEDED = 'Confirm it is you again, then try again.';
const STEP_UP_FAILED = 'Your password or code is not right. Check them and try again.';

const needsStepUp = (error: unknown): boolean =>
  error instanceof ProblemError && error.status === 403 && error.detail === STEP_UP_NEEDED;

/**
 * Runs an action. If the API says it needs a recent sign-in, asks the person
 * to confirm it is them and runs it once more. Gives null when they cancel.
 * Any other failure, or a second refusal, is thrown. Put `dialog` in the page.
 */
export function useStepUp(): {
  run: <T>(action: () => Promise<T>) => Promise<T | null>;
  dialog: ReactNode;
} {
  const { setSession } = useSession();
  const [answer, setAnswer] = useState<((confirmed: boolean) => void) | null>(null);
  const confirmed = useRef(false);

  async function run<T>(action: () => Promise<T>): Promise<T | null> {
    try {
      return await action();
    } catch (error) {
      if (!needsStepUp(error)) throw error;
    }
    const asked = await new Promise<boolean>((resolve) => {
      confirmed.current = false;
      setAnswer(() => resolve);
    });
    return asked ? action() : null;
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
        try {
          setSession(await call(stepUp, { body: credentials }));
        } catch {
          throw new ProblemError(403, STEP_UP_FAILED);
        }
        confirmed.current = true;
      }}
    />
  );

  return { run, dialog };
}
