// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Button,
  Link,
  LoadingState,
  PageHeading,
  useLocation,
  useNavigate,
  useSearch,
  useSession,
} from '@pixel-scientists/ui';
import type { SearchSchema } from '@pixel-scientists/ui';
import { useEffect } from 'react';

import { AuthFrame } from '../AuthFrame.tsx';
import { redirectFor, usePageSearch } from '../redirects.ts';

const reasons: Record<string, string> = {
  expired: 'The sign-in took too long to finish. Try again.',
  mfa_required:
    'Your organisation did not confirm multi-factor authentication. Try again or ask your administrator.',
};

export const defaultReason =
  "Your organisation's sign-in did not confirm your identity. Try again or ask your administrator.";

/** The words for a reason code from the server. A code this page does not know gets the general words. */
export function reasonText(code: string | null): string {
  return (code !== null && reasons[code]) || defaultReason;
}

const reasonSearch: SearchSchema<{ reason: string | null }> = {
  safeParse(input) {
    const { reason } = input as Record<string, string | string[] | undefined>;
    return { success: true, data: { reason: typeof reason === 'string' ? reason : null } };
  },
};

/** The page a refused single sign-on lands on: what happened, and the way back to sign in. */
export function SsoFailedPage() {
  const result = useSearch(reasonSearch);
  return (
    <AuthFrame>
      <PageHeading>Single sign-on did not work</PageHeading>
      <p role="alert" className="text-body">
        {reasonText(result.success ? result.data.reason : null)}
      </p>
      <p className="text-body">
        <Link to="/sign-in">Back to sign in</Link>
      </p>
    </AuthFrame>
  );
}

/** Where a completed sign-in lands: wait for the session, then go on to where the person was headed. */
export function SsoSigningInPage() {
  const { state, reload } = useSession();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const { next } = usePageSearch();
  const destination = redirectFor('account', state, `${pathname}${search}`, next);

  useEffect(() => {
    if (state.status === 'signed-out') navigate('/sign-in/sso/failed', { replace: true });
    else if (destination !== null) navigate(destination, { replace: true });
  }, [state.status, destination, navigate]);

  if (state.status === 'failed') {
    return (
      <AuthFrame>
        <PageHeading>We could not check your session</PageHeading>
        <p className="text-body text-muted">Check your connection, then try again.</p>
        <div>
          <Button variant="primary" onClick={reload}>
            Try again
          </Button>
        </div>
      </AuthFrame>
    );
  }
  return (
    <AuthFrame>
      <PageHeading>Signing you in</PageHeading>
      <LoadingState label="Signing you in" />
    </AuthFrame>
  );
}
