// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Where an invitation's emailed link lands (ADR 0010). The token is in the
// address after `#token=`: the page reads it once, keeps it in memory only,
// and takes it out of the address bar. Signed out, it explains what to do
// first, and the person opens the link again afterwards, as the token is
// never stored. Signed in, one button spends it.

import { ProblemError } from '@pixel-scientists/domain/api';
import { acceptInvitation, tokenSchema } from '@pixel-scientists/domain/auth';
import {
  Button,
  ErrorSummary,
  Link,
  LoadingState,
  PageHeading,
  buttonClassName,
  useNavigate,
  useSession,
  useSubmit,
} from '@pixel-scientists/ui';
import { useEffect, useRef, useState } from 'react';

import { callApi } from '../../api.ts';
import { AuthFrame } from '../../auth/AuthFrame.tsx';
import { useFragmentToken } from '../../auth/useFragmentToken.ts';
import { useTenantLook } from '../settings/look.tsx';

const again = 'Then open the link in your invitation email again.';

/** Takes focus when it appears, so a refused token is announced where the Accept button was. */
function NotValid() {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <>
      <PageHeading ref={heading}>This invitation link is not valid</PageHeading>
      <p className="text-body text-muted">
        It may have been used already, or it may have run out. Ask the person who invited you for a
        new invitation.
      </p>
    </>
  );
}

function Accept({ token, onRefused }: { token: string; onRefused: () => void }) {
  const { state, setSession, signOut } = useSession();
  const navigate = useNavigate();
  const form = useSubmit(['token'], async () => {
    try {
      setSession(await callApi(acceptInvitation, { body: { token } }));
    } catch (error) {
      // Whatever the reason, the server answers a refused token the same way.
      if (error instanceof ProblemError && error.status === 404) {
        onRefused();
        return;
      }
      throw error;
    }
    navigate('/');
  });
  const email = state.status === 'ready' ? state.session.user.email : '';

  return (
    <>
      <PageHeading>Accept your invitation</PageHeading>
      <p className="text-body text-muted">
        You are signed in as <strong className="font-medium text-ink">{email}</strong>. Accept the
        invitation to join the team and open the console.
      </p>
      <form noValidate onSubmit={form.onSubmit} className="flex flex-col gap-4">
        <ErrorSummary key={form.attempt} errors={form.errors} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" aria-disabled={form.pending || undefined}>
            Accept invitation
          </Button>
          <Button
            onClick={() => {
              void signOut();
            }}
          >
            Sign out
          </Button>
        </div>
      </form>
      <p className="text-body text-muted">
        Is this not the address the invitation was sent to? Sign out, then sign in with that one.
      </p>
    </>
  );
}

function Invitation() {
  const token = useFragmentToken();
  const { state, reload } = useSession();
  const { tenant } = useTenantLook();
  const [refused, setRefused] = useState(false);

  if (token === null || !tokenSchema.safeParse(token).success || refused) return <NotValid />;

  if (state.status === 'loading') {
    return (
      <>
        <PageHeading>Checking your session</PageHeading>
        <LoadingState label="Loading" />
      </>
    );
  }
  if (state.status === 'failed') {
    return (
      <>
        <PageHeading>We could not check your session</PageHeading>
        <p className="text-body text-muted">Check your connection, then try again.</p>
        <div>
          <Button variant="primary" onClick={reload}>
            Try again
          </Button>
        </div>
      </>
    );
  }
  if (state.status === 'ready' && state.session.mfa === 'complete') {
    return (
      <Accept
        token={token}
        onRefused={() => {
          setRefused(true);
        }}
      />
    );
  }

  const links =
    state.status === 'ready' ? (
      <Link
        to={state.session.mfa === 'enrol' ? '/set-up-authenticator' : '/enter-code'}
        className={buttonClassName('primary')}
      >
        {state.session.mfa === 'enrol' ? 'Set up your authenticator app' : 'Enter your code'}
      </Link>
    ) : (
      <>
        <Link to="/sign-up" className={buttonClassName('primary')}>
          Create an account
        </Link>
        <Link to="/sign-in" className={buttonClassName()}>
          Sign in
        </Link>
      </>
    );

  return (
    <>
      <PageHeading>Join {tenant?.name ?? 'the team'}</PageHeading>
      <p className="text-body text-muted">
        {state.status === 'ready'
          ? 'You need to finish signing in before you can accept.'
          : 'Before you can accept, create an account or sign in. Use the email address the invitation was sent to.'}{' '}
        {again}
      </p>
      <div className="flex flex-wrap gap-2">{links}</div>
    </>
  );
}

export default function InvitationPage() {
  return (
    <AuthFrame>
      <Invitation />
    </AuthFrame>
  );
}
