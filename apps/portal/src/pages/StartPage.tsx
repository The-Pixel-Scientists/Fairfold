// SPDX-License-Identifier: AGPL-3.0-or-later

import { EmptyState, Link, buttonClassName, useSession } from '@pixel-scientists/ui';

import { Screen } from '../auth/Screen.tsx';
import { standaloneLink } from '../links.ts';
import { PageColumn, PageIntro } from '../PageColumn.tsx';
import { HOW_APPLYING_WORKS_PATH, SIGN_IN_PATH, SIGN_UP_PATH } from '../paths.ts';

/** What someone who is not signed in sees first: two ways in, and what to expect. */
function Welcome() {
  return (
    <PageColumn>
      <PageIntro title="Apply for a grant">
        <p>
          Create an account with your email address. Then you can see which grants are open and
          start an application.
        </p>
        <p>Setting up takes a few minutes. You only need your email address.</p>
      </PageIntro>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Link to={SIGN_UP_PATH} className={buttonClassName('primary', 'w-full sm:w-auto')}>
          Create an account
        </Link>
        <Link to={SIGN_IN_PATH} className={buttonClassName('secondary', 'w-full sm:w-auto')}>
          Sign in
        </Link>
      </div>
      <div>
        {/* Outside the funder's address, so the page loads afresh instead of going through its router. */}
        <a href={HOW_APPLYING_WORKS_PATH} className={standaloneLink}>
          Read how applying works
        </a>
      </div>
    </PageColumn>
  );
}

/** What a signed-in applicant sees. Grants cannot be opened yet, so it says so and what will happen. */
function Applications() {
  return (
    <PageColumn>
      <PageIntro title="Apply for a grant">
        <p>You are signed in. You have not started an application yet.</p>
      </PageIntro>
      <EmptyState title="No grants are open yet">
        <p>
          When a grant opens, it will appear here. We will tell you what you need before you start.
          You do not need to do anything now.
        </p>
      </EmptyState>
    </PageColumn>
  );
}

/** The funder's front door: the start page for a visitor, and the applicant's own page once signed in. */
export default function StartPage() {
  const { state } = useSession();
  return <Screen kind="open">{state.status === 'ready' ? <Applications /> : <Welcome />}</Screen>;
}
