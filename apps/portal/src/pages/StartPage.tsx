// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link, buttonClassName, useSession } from '@pixel-scientists/ui';

import { Screen } from '../auth/Screen.tsx';
import { useFunderName } from '../funder.tsx';
import { standaloneLink } from '../links.ts';
import { PageColumn, PageIntro } from '../PageColumn.tsx';
import { GetReady } from '../party/GetReady.tsx';
import { SavedNotice } from '../party/Saved.tsx';
import {
  APPLICATIONS_PATH,
  HOW_APPLYING_WORKS_PATH,
  PROGRAMMES_PATH,
  SIGN_IN_PATH,
  SIGN_UP_PATH,
} from '../paths.ts';

/** What someone who is not signed in sees first: two ways in, and what to expect. */
function Welcome() {
  const funder = useFunderName() ?? 'the funder';
  return (
    <PageColumn>
      <PageIntro title="Apply for a grant">
        <p>
          Create an account with your email address. Then you can see which grants {funder} has open
          and start an application.
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

/** What a signed-in applicant sees: where to find a grant, their applications, and how ready they are. */
function Applications() {
  return (
    <PageColumn>
      <PageIntro title="Apply for a grant">
        <SavedNotice />
        <p>You are signed in. Choose a programme to apply to, or carry on with an application.</p>
      </PageIntro>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Link to={PROGRAMMES_PATH} className={buttonClassName('primary', 'w-full sm:w-auto')}>
          Programmes you can apply to
        </Link>
        <Link to={APPLICATIONS_PATH} className={buttonClassName('secondary', 'w-full sm:w-auto')}>
          Your applications
        </Link>
      </div>
      <GetReady />
    </PageColumn>
  );
}

/** The funder's front door: the start page for a visitor, and the applicant's own page once signed in. */
export default function StartPage() {
  const { state } = useSession();
  return <Screen kind="open">{state.status === 'ready' ? <Applications /> : <Welcome />}</Screen>;
}
