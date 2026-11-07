// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Where the email change link lands. The token is in the address after
// `#token=`: the page reads it once, keeps it in memory only, and takes it
// out of the address bar. It calls nothing until the button is pressed.

import { ProblemError } from '@pixel-scientists/domain/api';
import { completeEmailChange, tokenSchema } from '@pixel-scientists/domain/auth';
import {
  Button,
  ErrorSummary,
  Link,
  PageHeading,
  buttonClassName,
  useSubmit,
} from '@pixel-scientists/ui';
import { useState } from 'react';

import { callApi } from '../../api.ts';
import { AuthFrame } from '../../auth/AuthFrame.tsx';
import { useFocusOnChange } from '../../auth/useFocusOnChange.ts';
import { useFragmentToken } from '../../auth/useFragmentToken.ts';

function EmailChange() {
  const token = useFragmentToken();
  const [done, setDone] = useState(false);
  const [refused, setRefused] = useState(false);
  const form = useSubmit(['token'], async () => {
    try {
      await callApi(completeEmailChange, { body: { token: token ?? '' } });
      setDone(true);
    } catch (error) {
      if (error instanceof ProblemError && error.status === 404) {
        setRefused(true);
        return;
      }
      throw error;
    }
  });

  const view =
    token === null || !tokenSchema.safeParse(token).success || refused
      ? 'refused'
      : done
        ? 'done'
        : 'confirm';
  // Each view replaces the last, so focus follows to the new heading, which says what happened.
  const heading = useFocusOnChange<HTMLHeadingElement>(view);

  if (view === 'refused') {
    return (
      <>
        <PageHeading ref={heading}>This link does not work</PageHeading>
        <p className="text-body text-muted">
          It may have been used already, or it may have run out. Change your email address again
          from Account security to get a new link.
        </p>
      </>
    );
  }
  if (view === 'done') {
    return (
      <>
        <PageHeading ref={heading}>Your email address has changed</PageHeading>
        <p className="text-body text-muted">Sign in with your new email address.</p>
        <div>
          <Link to="/sign-in" className={buttonClassName('primary')}>
            Sign in
          </Link>
        </div>
      </>
    );
  }
  return (
    <>
      <PageHeading ref={heading}>Confirm your new email address</PageHeading>
      <p className="text-body text-muted">
        Your email address changes only when you confirm it here.
      </p>
      <form noValidate onSubmit={form.onSubmit} className="flex flex-col gap-4">
        <ErrorSummary key={form.attempt} errors={form.errors} />
        <div>
          <Button type="submit" variant="primary" aria-disabled={form.pending || undefined}>
            Confirm new email address
          </Button>
        </div>
      </form>
    </>
  );
}

export default function EmailChangePage() {
  return (
    <AuthFrame>
      <EmailChange />
    </AuthFrame>
  );
}
