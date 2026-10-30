// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, Notice, useCan } from '@pixel-scientists/ui';
import { useState } from 'react';

import type { EmailDelivery } from '../../contracts/index.ts';
import { problemLines } from '../assessment/problems.ts';
import { Failure } from './Failure.tsx';
import { sendUnsent } from './loaders.ts';
import { countOf } from './totals.ts';
import { useStepUp } from './useStepUp.tsx';

export interface UnsentEmailsProps {
  roundId: string;
  /** How many emails are waiting to send or were not sent. */
  count: number;
  onSent: (delivery: EmailDelivery) => void;
}

/**
 * Says that emails have not gone, and sends them again. Applicants can already
 * read a released decision when they sign in. Only for someone who can release.
 */
export function UnsentEmails({ roundId, count, onSent }: UnsentEmailsProps) {
  const canRelease = useCan('grants.decisions.release');
  const stepUp = useStepUp();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<readonly string[]>([]);
  if (count === 0) return null;

  async function send() {
    if (pending) return;
    setPending(true);
    setFailure([]);
    try {
      const delivery = await stepUp.run(() => sendUnsent(roundId));
      if (delivery !== null) onSent(delivery);
    } catch (error) {
      setFailure(problemLines(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Notice
        tone="warning"
        title={`${countOf(count, 'decision email')} not sent`}
        action={
          canRelease && (
            <Button
              aria-disabled={pending || undefined}
              onClick={() => {
                void send();
              }}
            >
              Send unsent emails
            </Button>
          )
        }
      >
        Applicants can read a released decision when they sign in, but they have not had the email
        yet. Sending tries each one again, up to 500 at a time.
      </Notice>
      <Failure lines={failure} />
      {stepUp.dialog}
    </>
  );
}
