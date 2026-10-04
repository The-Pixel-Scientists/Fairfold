// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';

import { Button } from '../Button.tsx';
import { Dialog } from '../dialog/index.ts';

export interface TimeoutDialogProps {
  open: boolean;
  /** Milliseconds until the session ends. */
  remainingMs: number;
  /** Read the session again, which keeps it alive. Rejects when that fails. */
  onStay: () => Promise<void>;
  onSignOut: () => Promise<void>;
}

const STEP_SECONDS = 30;

function plural(count: number, unit: string): string {
  return `${String(count)} ${unit}${count === 1 ? '' : 's'}`;
}

/** The time left in words, rounded up to 30 seconds so a screen reader hears it only twice a minute. */
export function spokenDuration(ms: number): string {
  const seconds = Math.max(STEP_SECONDS, Math.ceil(ms / 1000 / STEP_SECONDS) * STEP_SECONDS);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return [minutes > 0 && plural(minutes, 'minute'), rest > 0 && plural(rest, 'second')]
    .filter(Boolean)
    .join(' ');
}

function clock(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * The warning before an idle session ends (ADR 0010). It says how long is
 * left and offers to keep working or to sign out. Escape and a click outside
 * count as staying signed in. The countdown on screen is hidden from screen
 * readers; a polite status gives the time every 30 seconds instead.
 */
export function TimeoutDialog({ open, remainingMs, onStay, onSignOut }: TimeoutDialogProps) {
  const [failed, setFailed] = useState(false);

  async function run(action: () => Promise<void>) {
    setFailed(false);
    try {
      await action();
    } catch {
      setFailed(true);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) void run(onStay);
      }}
      title="You will be signed out soon"
      description="You have not used this page for a while. We sign you out when a session sits idle, to keep your account safe."
      actions={
        <>
          <Button onClick={() => void run(onSignOut)}>Sign out</Button>
          <Button variant="primary" data-autofocus onClick={() => void run(onStay)}>
            Stay signed in
          </Button>
        </>
      }
    >
      <p aria-hidden="true" className="text-2xl font-semibold text-ink">
        {clock(remainingMs)}
      </p>
      <p role="status" className="sr-only">
        {`You will be signed out in ${spokenDuration(remainingMs)}.`}
      </p>
      {failed && (
        <p role="alert" className="text-body font-medium text-danger">
          We could not reach the service. Try again, or sign out.
        </p>
      )}
    </Dialog>
  );
}
