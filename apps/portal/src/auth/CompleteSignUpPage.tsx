// SPDX-License-Identifier: AGPL-3.0-or-later

import { completeSignUp, tokenSchema } from '@pixel-scientists/domain/auth';
import { ErrorSummary, formText, useNavigate, useSubmit } from '@pixel-scientists/ui';

import { callApi } from '../api.ts';
import { PageColumn, PageIntro } from '../PageColumn.tsx';
import { SIGN_IN_PATH, SIGN_UP_PATH } from '../paths.ts';
import { PasswordField, SubmitButton } from './fields.tsx';
import { LinkNotValid } from './LinkNotValid.tsx';
import { Prompt } from './Prompt.tsx';
import { withQuery } from './redirects.ts';
import { Screen } from './Screen.tsx';
import { useFragmentToken } from './useFragmentToken.ts';

function CompleteSignUp() {
  const token = useFragmentToken();
  const navigate = useNavigate();
  const form = useSubmit(['password'], async (data) => {
    await callApi(completeSignUp, {
      body: { token: token ?? '', password: formText(data, 'password') },
    });
    navigate(withQuery(SIGN_IN_PATH, null, 'account-created'));
  });

  if (token === null || !tokenSchema.safeParse(token).success) {
    return <LinkNotValid askAgainTo={SIGN_UP_PATH} lasts="24 hours" />;
  }

  return (
    <PageColumn>
      <PageIntro title="Set your password">
        <p>Thank you for checking your email. Choose a password to finish making your account.</p>
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
          label="Create account"
          pendingLabel="Creating account…"
        />
      </form>
      <Prompt to={SIGN_UP_PATH} link="Ask for a new link">
        Is the link not working?
      </Prompt>
    </PageColumn>
  );
}

export default function CompleteSignUpPage() {
  return (
    <Screen kind="account">
      <CompleteSignUp />
    </Screen>
  );
}
