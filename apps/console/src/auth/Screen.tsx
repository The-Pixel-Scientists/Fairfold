// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Button,
  LoadingState,
  PageHeading,
  useLocation,
  useNavigate,
  useSession,
} from '@pixel-scientists/ui';
import { useEffect } from 'react';
import type { ReactNode } from 'react';

import { ConsoleShell } from '../shell/ConsoleShell.tsx';
import { useTenantSlug } from '../tenant.ts';
import { AccessPage } from './AccessPage.tsx';
import { AuthFrame } from './AuthFrame.tsx';
import { redirectFor, usePageSearch } from './redirects.ts';
import type { PageKind } from './redirects.ts';

/**
 * Every page of the funder's console is wrapped in a Screen, which keeps each
 * visitor where their session says they belong: signed-out visitors go to
 * sign in (and back here afterwards), people with MFA still to do go to its
 * page, and signed-in people leave the sign-in pages. A signed-in person who
 * is not working for this funder is told so, and can switch.
 */
export function Screen({ kind, children }: { kind: PageKind; children: ReactNode }) {
  const { state, reload } = useSession();
  const slug = useTenantSlug();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const { next } = usePageSearch();
  const destination = redirectFor(kind, state, `${pathname}${search}`, next);

  useEffect(() => {
    if (destination !== null) navigate(destination, { replace: true });
  }, [destination, navigate]);

  if (state.status === 'loading') {
    return (
      <AuthFrame>
        <PageHeading>Checking your session</PageHeading>
        <LoadingState label="Loading" />
      </AuthFrame>
    );
  }
  if (state.status === 'failed') {
    return (
      <AuthFrame>
        <PageHeading>We could not check your session</PageHeading>
        <p className="text-body text-muted">
          Check your connection, then try again. If this keeps happening, tell your administrator.
        </p>
        <div>
          <Button variant="primary" onClick={reload}>
            Try again
          </Button>
        </div>
      </AuthFrame>
    );
  }
  if (destination !== null) return null;
  if (kind !== 'member') return <AuthFrame>{children}</AuthFrame>;
  if (state.status !== 'ready') return null;

  const { session } = state;
  if (session.activeMembership?.tenant.slug !== slug) {
    return (
      <AuthFrame>
        <AccessPage session={session} slug={slug} />
      </AuthFrame>
    );
  }
  return <ConsoleShell session={session}>{children}</ConsoleShell>;
}
