// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, Dialog, useSession } from '@pixel-scientists/ui';
import type { SessionData } from '@pixel-scientists/ui';
import { useState } from 'react';

import { FunderList } from './FunderList.tsx';

/**
 * The header's account area: the funder, who is signed in, a way to switch
 * to another funder (only for someone who has more than one) and "Sign out".
 */
export function AccountControls({ session }: { session: SessionData }) {
  const { signOut } = useSession();
  const [switching, setSwitching] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const others = session.memberships.filter(({ id }) => id !== session.activeMembership?.id);

  return (
    <>
      <p className="text-body">
        <span className="font-medium text-ink">{session.activeMembership?.tenant.name}</span>{' '}
        <span className="text-muted">{session.user.email}</span>
      </p>
      {others.length > 0 && (
        <Button
          onClick={() => {
            setSwitching(true);
          }}
        >
          Switch funder
        </Button>
      )}
      <Button
        onClick={() => {
          setSignOutFailed(false);
          signOut().catch(() => {
            setSignOutFailed(true);
          });
        }}
      >
        Sign out
      </Button>
      {signOutFailed && (
        <p role="alert" className="text-body font-medium text-danger">
          We could not sign you out. Check your connection and try again.
        </p>
      )}
      <Dialog
        open={switching}
        onOpenChange={setSwitching}
        title="Switch funder"
        description="Choose the funder to work for. You will be taken to its console."
      >
        <FunderList memberships={others} />
      </Dialog>
    </>
  );
}
