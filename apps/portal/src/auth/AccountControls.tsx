// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SessionData } from '@pixel-scientists/ui';

import { SignOutButton } from './SignOutButton.tsx';

/** The header's account area: who is signed in, and "Sign out". */
export function AccountControls({ session }: { session: SessionData }) {
  return (
    <>
      <p className="min-w-0 text-body text-muted [overflow-wrap:anywhere]">{session.user.email}</p>
      <SignOutButton />
    </>
  );
}
