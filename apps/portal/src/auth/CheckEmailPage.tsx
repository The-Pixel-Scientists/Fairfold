// SPDX-License-Identifier: AGPL-3.0-or-later

import { PageColumn, PageIntro } from '../PageColumn.tsx';
import { SIGN_UP_PATH } from '../paths.ts';
import { EmailNotArrived } from './EmailNotArrived.tsx';
import { Screen } from './Screen.tsx';

/** The page never repeats the address, so it reads the same whoever asked. */
export default function CheckEmailPage() {
  return (
    <Screen kind="account">
      <PageColumn>
        <PageIntro title="Check your email">
          <p>
            We have sent you an email. Open it and follow the link to set your password. It can take
            a few minutes to arrive.
          </p>
          <p>The link works once, and it lasts 24 hours.</p>
        </PageIntro>
        <EmailNotArrived askAgainTo={SIGN_UP_PATH} />
      </PageColumn>
    </Screen>
  );
}
