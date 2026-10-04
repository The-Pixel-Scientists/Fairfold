// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link, PageHeading, buttonClassName } from '@pixel-scientists/ui';

import { Screen } from './Screen.tsx';

export default function SignedOutPage() {
  return (
    <Screen kind="account">
      <PageHeading>You have signed out</PageHeading>
      <p className="text-body text-muted">
        Your session has ended on this device. You can close this tab, or sign in again.
      </p>
      <div>
        <Link to="/sign-in" className={buttonClassName('primary')}>
          Sign in again
        </Link>
      </div>
    </Screen>
  );
}
