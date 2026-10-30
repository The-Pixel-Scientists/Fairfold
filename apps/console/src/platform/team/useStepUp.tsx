// SPDX-License-Identifier: AGPL-3.0-or-later

import { StepUpDialog, useSession } from '@pixel-scientists/ui';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { confirmItsYou } from '../../auth/stepUp.ts';
import { needsStepUp } from './change.ts';

export interface StepUp {
  /**
   * Runs the action. If the API says it needs a recent sign-in, asks the
   * person to confirm it is them and runs it once more. Gives `null` when
   * they cancel instead. Any other failure, or a second refusal, is thrown.
   */
  run: <T>(action: () => Promise<T>) => Promise<T | null>;
  /** True while the person is being asked, so a dialog behind it can step aside. */
  asking: boolean;
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

  return { run, asking: answer !== null, dialog };
}
