// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link, buttonClassName } from '@pixel-scientists/ui';

import { PageColumn, PageIntro } from '../PageColumn.tsx';
import { SIGN_IN_PATH } from '../paths.ts';
import { Screen } from './Screen.tsx';

export default function SignedOutPage() {
  return (
    <Screen kind="account">
      <PageColumn>
        <PageIntro title="You have signed out">
          <p>
            You are signed out on this device. Anything you saved is still there when you sign in
            again.
          </p>
          <p>You can close this tab, or sign in again.</p>
        </PageIntro>
        <div>
          <Link to={SIGN_IN_PATH} className={buttonClassName('primary', 'w-full sm:w-auto')}>
            Sign in again
          </Link>
        </div>
      </PageColumn>
    </Screen>
  );
}
