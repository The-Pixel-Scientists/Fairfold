// SPDX-License-Identifier: AGPL-3.0-or-later

import { signIn } from '@pixel-scientists/domain/auth';
import { ErrorSummary, formText, useSession, useSubmit } from '@pixel-scientists/ui';

import { callApi } from '../api.ts';
import { PageColumn, PageIntro } from '../PageColumn.tsx';
import { FORGOT_PASSWORD_PATH, SIGN_UP_PATH } from '../paths.ts';
import { useTenantSlug } from '../tenant.ts';
import { refusedSignIn } from './failures.ts';
import { EmailField, PasswordField, SubmitButton } from './fields.tsx';
import { Prompt } from './Prompt.tsx';
import { usePageSearch } from './redirects.ts';
import type { Notice } from './redirects.ts';
import { Screen } from './Screen.tsx';

const FIELDS = ['email', 'password'] as const;

const noticeText: Record<Notice, string> = {
  timeout:
    'You were signed out because you had not used the page for a while. Anything you saved is still there. Sign in to carry on.',
  'account-created': 'Your account is ready. Sign in to get started.',
  'password-reset': 'Your password has changed. Sign in with your new password.',
};

function SignIn() {
  const slug = useTenantSlug();
  const { setSession } = useSession();
  const { notice } = usePageSearch();
  const form = useSubmit(FIELDS, async (data) => {
    try {
      setSession(
        await callApi(signIn, {
          params: { slug },
          body: { email: formText(data, 'email'), password: formText(data, 'password') },
        }),
      );
    } catch (error) {
      throw refusedSignIn(error);
    }
  });

  return (
    <PageColumn>
      <PageIntro title="Sign in">
        {notice !== null && (
          <p className="rounded-md border border-divider bg-accent-soft p-4 text-body text-ink">
            {noticeText[notice]}
          </p>
        )}
      </PageIntro>
      <form noValidate onSubmit={form.onSubmit} className="flex max-w-md flex-col gap-6">
        <ErrorSummary key={form.attempt} errors={form.errors} />
        <EmailField autoComplete="username" error={form.errorFor('email')} />
        <PasswordField autoComplete="current-password" error={form.errorFor('password')} />
        <SubmitButton pending={form.pending} label="Sign in" pendingLabel="Signing in…" />
      </form>
      <div className="flex flex-col items-start">
        <Prompt to={FORGOT_PASSWORD_PATH} link="Forgot your password?" />
        <Prompt to={SIGN_UP_PATH} link="Create an account">
          New here?
        </Prompt>
      </div>
    </PageColumn>
  );
}

export default function SignInPage() {
  return (
    <Screen kind="account">
      <SignIn />
    </Screen>
  );
}
