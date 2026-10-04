// SPDX-License-Identifier: AGPL-3.0-or-later

import { requestPasswordReset } from '@pixel-scientists/domain/auth';
import { ErrorSummary, formText, useNavigate, useSubmit } from '@pixel-scientists/ui';

import { callApi } from '../api.ts';
import { PageColumn, PageIntro } from '../PageColumn.tsx';
import { PASSWORD_RESET_SENT_PATH, SIGN_IN_PATH } from '../paths.ts';
import { useTenantSlug } from '../tenant.ts';
import { EmailField, SubmitButton } from './fields.tsx';
import { Prompt } from './Prompt.tsx';
import { Screen } from './Screen.tsx';

function ForgotPassword() {
  const slug = useTenantSlug();
  const navigate = useNavigate();
  const form = useSubmit(['email'], async (data) => {
    await callApi(requestPasswordReset, {
      params: { slug },
      body: { email: formText(data, 'email') },
    });
    navigate(PASSWORD_RESET_SENT_PATH);
  });

  return (
    <PageColumn>
      <PageIntro title="Reset your password">
        <p>
          Enter the email address you use to sign in. We will email you a link to choose a new
          password.
        </p>
      </PageIntro>
      <form noValidate onSubmit={form.onSubmit} className="flex max-w-md flex-col gap-6">
        <ErrorSummary key={form.attempt} errors={form.errors} />
        <EmailField error={form.errorFor('email')} />
        <SubmitButton
          pending={form.pending}
          label="Email me a reset link"
          pendingLabel="Sending…"
        />
      </form>
      <Prompt to={SIGN_IN_PATH} link="Sign in">
        Remembered it?
      </Prompt>
    </PageColumn>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Screen kind="account">
      <ForgotPassword />
    </Screen>
  );
}
