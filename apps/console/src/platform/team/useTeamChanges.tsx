// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { performTeamChange } from './teamChange.ts';
import type { TeamChange, TeamOutcome } from './teamChange.ts';
import { useStepUp } from './useStepUp.tsx';

export interface TeamChanges {
  /** Makes a change behind step-up. Throws what went wrong; on success, applies it and closes the dialog. */
  run: (change: TeamChange) => Promise<void>;
  /** True while the person is being asked to confirm it is them. */
  asking: boolean;
  /**
   * Put this in the page. It says the outcome once in a polite live region, as a
   * fresh node each time, and takes focus when the change removed what had it.
   */
  status: ReactNode;
  /** Put this in the page. */
  dialog: ReactNode;
}

/** The part every team screen shares: step-up, the call, and what to do when it works. */
export function useTeamChanges(onDone: (outcome: TeamOutcome) => void): TeamChanges {
  const stepUp = useStepUp();
  const [message, setMessage] = useState({ text: '', count: 0 });
  const status = useRef<HTMLParagraphElement>(null);

  // A closed dialog gives focus back to its button; when the change removed that button, the message keeps it.
  useEffect(() => {
    if (message.count === 0) return undefined;
    const timer = setTimeout(() => {
      const active = document.activeElement;
      if (active === null || active === document.body || !active.isConnected) {
        status.current?.focus();
      }
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [message.count]);

  async function run(change: TeamChange): Promise<void> {
    const outcome = await stepUp.run(() => performTeamChange(change));
    if (outcome === null) return;
    setMessage(({ count }) => ({ text: outcome.message, count: count + 1 }));
    onDone(outcome);
  }

  return {
    run,
    asking: stepUp.asking,
    status: (
      <p
        ref={status}
        role="status"
        tabIndex={-1}
        key={message.count}
        className="min-h-6 text-body font-medium text-success"
      >
        {message.text}
      </p>
    ),
    dialog: stepUp.dialog,
  };
}
