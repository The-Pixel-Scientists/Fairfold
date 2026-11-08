// SPDX-License-Identifier: AGPL-3.0-or-later

import { completeEmailChange, tokenSchema } from '@pixel-scientists/domain/auth';
import { ErrorSummary, Link, buttonClassName, useSubmit } from '@pixel-scientists/ui';
import { useState } from 'react';

import { callApi } from '../api.ts';
import { SubmitButton } from '../auth/fields.tsx';
import { LinkNotValid } from '../auth/LinkNotValid.tsx';
import { useFragmentToken } from '../auth/useFragmentToken.ts';
import { PageColumn, PageIntro } from '../PageColumn.tsx';
import { ACCOUNT_PATH, SIGN_IN_PATH } from '../paths.ts';
import { PortalShell } from '../shell/PortalShell.tsx';

/**
 * The page the emailed link opens. Opening it changes nothing: the token is
 * read from the address fragment, taken out of the address bar, and only
 * spent when the button is pressed. It does not use a Screen, because
 * changing the address ends every session and this page must stay to say so.
 */
function EmailChange() {
  const token = useFragmentToken();
  const [done, setDone] = useState(false);
  const form = useSubmit([], async () => {
    await callApi(completeEmailChange, { body: { token: token ?? '' } });
    setDone(true);
  });

  if (done) {
    return (
      <PageColumn>
        <PageIntro title="Your email address has changed">
          <p>Use your new email address to sign in from now on.</p>
          <p>Anywhere else you were signed in has been signed out.</p>
        </PageIntro>
        <div>
          <Link to={SIGN_IN_PATH} className={buttonClassName('primary', 'w-full sm:w-auto')}>
            Sign in
          </Link>
        </div>
      </PageColumn>
    );
  }
  if (token === null || !tokenSchema.safeParse(token).success) {
    return <LinkNotValid askAgainTo={ACCOUNT_PATH} lasts="1 hour" />;
  }
  return (
    <PageColumn>
      <PageIntro title="Confirm your new email address">
        <p>Press the button to use the address we emailed from now on.</p>
        <p>We will sign you out of every device. You then sign in with the new address.</p>
      </PageIntro>
      <form noValidate onSubmit={form.onSubmit} className="flex max-w-md flex-col gap-6">
        <ErrorSummary key={form.attempt} errors={form.errors} />
        <SubmitButton
          pending={form.pending}
          label="Confirm new email address"
          pendingLabel="Confirming…"
        />
      </form>
    </PageColumn>
  );
}

export default function EmailChangePage() {
  return (
    <PortalShell>
      <EmailChange />
    </PortalShell>
  );
}
