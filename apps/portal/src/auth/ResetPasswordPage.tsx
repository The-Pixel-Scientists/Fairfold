// SPDX-License-Identifier: AGPL-3.0-or-later

import { completePasswordReset, tokenSchema } from '@pixel-scientists/domain/auth';
import { ErrorSummary, formText, useNavigate, useSubmit } from '@pixel-scientists/ui';

import { callApi } from '../api.ts';
import { PageColumn, PageIntro } from '../PageColumn.tsx';
import { FORGOT_PASSWORD_PATH, SIGN_IN_PATH } from '../paths.ts';
import { PasswordField, SubmitButton } from './fields.tsx';
import { LinkNotValid } from './LinkNotValid.tsx';
import { Prompt } from './Prompt.tsx';
import { withQuery } from './redirects.ts';
import { Screen } from './Screen.tsx';
import { useFragmentToken } from './useFragmentToken.ts';

function ResetPassword() {
  const token = useFragmentToken();
  const navigate = useNavigate();
  const form = useSubmit(['password'], async (data) => {
    await callApi(completePasswordReset, {
      body: { token: token ?? '', password: formText(data, 'password') },
    });
    navigate(withQuery(SIGN_IN_PATH, null, 'password-reset'));
  });

  if (token === null || !tokenSchema.safeParse(token).success) {
    return <LinkNotValid askAgainTo={FORGOT_PASSWORD_PATH} lasts="30 minutes" />;
  }

  return (
    <PageColumn>
      <PageIntro title="Choose a new password">
        <p>
          You will use this password to sign in from now on. Anywhere else you are signed in will be
          signed out.
        </p>
      </PageIntro>
      <form noValidate onSubmit={form.onSubmit} className="flex max-w-md flex-col gap-6">
        <ErrorSummary key={form.attempt} errors={form.errors} />
        <PasswordField
          autoComplete="new-password"
          hint="Use at least 12 characters. A few words together is easy to remember and hard to guess."
          error={form.errorFor('password')}
        />
        <SubmitButton
          pending={form.pending}
          label="Save new password"
          pendingLabel="Saving password…"
        />
      </form>
      <Prompt to={FORGOT_PASSWORD_PATH} link="Ask for a new link">
        Is the link not working?
      </Prompt>
    </PageColumn>
  );
}

export default function ResetPasswordPage() {
  return (
    <Screen kind="account">
      <ResetPassword />
    </Screen>
  );
}
