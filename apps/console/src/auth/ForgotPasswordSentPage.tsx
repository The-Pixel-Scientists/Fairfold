// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link, PageHeading } from '@pixel-scientists/ui';

import { Screen } from './Screen.tsx';

/** The same words whatever address was entered, so the page never says whether it has an account. */
export default function ForgotPasswordSentPage() {
  return (
    <Screen kind="account">
      <PageHeading>Check your email</PageHeading>
      <p className="text-body">
        If that address has an account here, we have sent it a link to choose a new password.
      </p>
      <p className="text-body text-muted">
        The link works once, for 30 minutes. If the email has not come in a few minutes, check your
        spam folder.
      </p>
      <p className="text-body">
        <Link to="/forgot-password">Use a different email address</Link>
      </p>
    </Screen>
  );
}
