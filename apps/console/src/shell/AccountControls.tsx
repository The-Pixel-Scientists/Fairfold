// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, Dialog, TenantLogo, useSession } from '@pixel-scientists/ui';
import type { SessionData } from '@pixel-scientists/ui';
import { useState } from 'react';

import { useTenantLook } from '../platform/settings/look.tsx';
import { useTenantSlug } from '../tenant.ts';
import { FunderList } from './FunderList.tsx';

/**
 * The header's account area: the funder's logo or name, who is signed in, a
 * way to switch to another funder (only for someone who has more than one)
 * and "Sign out".
 */
export function AccountControls({ session }: { session: SessionData }) {
  const { signOut } = useSession();
  const slug = useTenantSlug();
  const { tenant, version } = useTenantLook();
  const [switching, setSwitching] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const others = session.memberships.filter(({ id }) => id !== session.activeMembership?.id);

  return (
    <>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body">
        <TenantLogo
          slug={slug}
          name={tenant?.name ?? session.activeMembership?.tenant.name ?? slug}
          hasLogo={tenant?.theme.hasLogo ?? false}
          version={version}
        />
        <span className="text-muted [overflow-wrap:anywhere]">{session.user.email}</span>
      </p>
      {others.length > 0 && (
        <Button
          variant="quiet"
          onClick={() => {
            setSwitching(true);
          }}
        >
          Switch funder
        </Button>
      )}
      <Button
        variant="quiet"
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
