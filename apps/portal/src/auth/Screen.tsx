// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, LoadingState, useLocation, useNavigate, useSession } from '@pixel-scientists/ui';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { PageColumn, PageIntro } from '../PageColumn.tsx';
import { PortalShell } from '../PortalShell.tsx';
import { useTenantSlug } from '../tenant.ts';
import { AccountControls } from './AccountControls.tsx';
import { CannotApply } from './CannotApply.tsx';
import { redirectFor, usePageSearch } from './redirects.ts';
import type { PageKind } from './redirects.ts';

/**
 * Every page of a funder's portal is wrapped in a Screen, which keeps each
 * visitor where their session says they belong: signed-in people leave the
 * sign-in pages, and a session that has just ended leads to the page that
 * says so. A signed-in person who has no applicant membership with this
 * funder is told so, and can sign out.
 */
export function Screen({ kind, children }: { kind: PageKind; children: ReactNode }) {
  const { state, reload } = useSession();
  const slug = useTenantSlug();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const { next } = usePageSearch();
  // Whether this page has shown a signed-in person, so a session that ends here can say so.
  const [signedInHere, setSignedInHere] = useState(state.status === 'ready');
  if (state.status === 'ready' && !signedInHere) setSignedInHere(true);
  const destination = redirectFor(kind, state, `${pathname}${search}`, next, signedInHere);

  useEffect(() => {
    if (destination !== null) navigate(destination, { replace: true });
  }, [destination, navigate]);

  if (state.status === 'loading') {
    return (
      <PortalShell>
        <PageColumn>
          <PageIntro title="One moment" />
          <LoadingState label="Loading" />
        </PageColumn>
      </PortalShell>
    );
  }
  if (state.status === 'failed') {
    return (
      <PortalShell>
        <PageColumn>
          <PageIntro title="We could not connect">
            <p>
              Check that you are online, then press the button. If it still does not work, wait a
              few minutes and try once more.
            </p>
          </PageIntro>
          <div>
            <Button variant="primary" className="w-full sm:w-auto" onClick={reload}>
              Try again
            </Button>
          </div>
        </PageColumn>
      </PortalShell>
    );
  }
  if (destination !== null) return null;
  if (state.status === 'signed-out') return <PortalShell>{children}</PortalShell>;

  const { session } = state;
  if (session.activeMembership?.tenant.slug !== slug) {
    return (
      <PortalShell>
        <CannotApply session={session} />
      </PortalShell>
    );
  }
  return <PortalShell actions={<AccountControls session={session} />}>{children}</PortalShell>;
}
