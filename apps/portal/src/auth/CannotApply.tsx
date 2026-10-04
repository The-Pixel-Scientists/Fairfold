// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SessionData } from '@pixel-scientists/ui';

import { PageColumn, PageIntro } from '../PageColumn.tsx';
import { SignOutButton } from './SignOutButton.tsx';

/**
 * Shown when the signed-in person has no applicant membership with the funder
 * in the address, or is signed in to another funder. The person is not
 * blamed, and the way forward is clear: sign out, then sign in again here.
 */
export function CannotApply({ session }: { session: SessionData }) {
  return (
    <PageColumn>
      <PageIntro title="This account cannot apply to this funder">
        <p>
          You are signed in as{' '}
          <strong className="[overflow-wrap:anywhere]">{session.user.email}</strong>. This account
          is not set up to apply here.
        </p>
        <p>
          To fix this, sign out and sign in again on this funder's page. You can use a different
          account if you have one.
        </p>
      </PageIntro>
      <div className="flex flex-col items-start gap-3">
        <SignOutButton primary />
      </div>
    </PageColumn>
  );
}
