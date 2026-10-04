// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link, PageHeading } from '@pixel-scientists/ui';

import { Screen } from './Screen.tsx';

export default function CheckEmailPage() {
  return (
    <Screen kind="account">
      <PageHeading>Check your email</PageHeading>
      <p className="text-body">
        We have sent an email to the address you entered. Open it and follow the link to set your
        password.
      </p>
      <p className="text-body text-muted">
        The link works once, for 24 hours. If the email has not come in a few minutes, check your
        spam folder.
      </p>
      <p className="text-body">
        <Link to="/sign-up">Use a different email address</Link>
      </p>
    </Screen>
  );
}
