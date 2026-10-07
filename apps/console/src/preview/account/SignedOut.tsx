// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Where Sign out leads in the previews: the same words as the console's own
// signed-out screen, with the link back to the start of the previews.

import { Link, PageHeading, buttonClassName } from '@pixel-scientists/ui';

export default function SignedOut() {
  return (
    <>
      <PageHeading>You have signed out</PageHeading>
      <p className="text-body text-muted">
        Your session has ended on this device. You can close this tab, or sign in again.
      </p>
      <div>
        <Link to="/" className={buttonClassName('primary')}>
          Sign in again
        </Link>
      </div>
    </>
  );
}
