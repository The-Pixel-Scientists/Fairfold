// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Preview of the page after "Sign out": it says you are signed out, that your
// work is safe, and offers to sign in again. It comes after the Riverside Lunch
// Club application was sent, so the work it keeps is the draft still open.
// Nothing here ends a real session.

import { Link, buttonClassName } from '@pixel-scientists/ui';

import { PageColumn } from '../PageColumn.tsx';
import { HOME_PATH } from '../paths.ts';
import { ScreenHeader } from './parts.tsx';
import { draftApplication } from './story.ts';

export default function SignedOut() {
  return (
    <PageColumn>
      <ScreenHeader title="You have signed out">
        <p>
          Your work is safe. We saved your application as you typed, and it will be here when you
          sign in again.
        </p>
      </ScreenHeader>

      <div className="flex flex-col gap-1 border-y border-divider py-5">
        <p className="text-sm font-medium text-muted">Your draft application</p>
        <p className="text-lg font-semibold text-ink">{draftApplication.project}</p>
        <p className="text-body text-muted">{draftApplication.fund}</p>
        <p className="text-body text-muted">
          Last saved <span className="whitespace-nowrap">{draftApplication.lastSaved}</span>
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <div>
          <Link to={HOME_PATH} className={buttonClassName('primary', 'w-full sm:w-auto')}>
            Sign in again
          </Link>
        </div>
        <p className="max-w-prose text-body text-muted">You can close this tab if you are done.</p>
      </div>
    </PageColumn>
  );
}
