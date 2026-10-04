// SPDX-License-Identifier: AGPL-3.0-or-later

import { PageColumn, PageIntro } from '../PageColumn.tsx';
import { FORGOT_PASSWORD_PATH } from '../paths.ts';
import { EmailNotArrived } from './EmailNotArrived.tsx';
import { Screen } from './Screen.tsx';

/** The same words whatever address was entered, so the page never says whether it has an account. */
export default function ForgotPasswordSentPage() {
  return (
    <Screen kind="account">
      <PageColumn>
        <PageIntro title="Check your email">
          <p>
            If that address has an account here, we have sent it a link to choose a new password. It
            can take a few minutes to arrive.
          </p>
          <p>The link works once, and it lasts 30 minutes.</p>
        </PageIntro>
        <EmailNotArrived askAgainTo={FORGOT_PASSWORD_PATH} />
      </PageColumn>
    </Screen>
  );
}
