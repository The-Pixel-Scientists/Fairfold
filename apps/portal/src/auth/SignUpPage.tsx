// SPDX-License-Identifier: AGPL-3.0-or-later

import { startSignUp } from '@pixel-scientists/domain/auth';
import { ErrorSummary, formText, useNavigate, useSubmit } from '@pixel-scientists/ui';

import { callApi } from '../api.ts';
import { PageColumn, PageIntro } from '../PageColumn.tsx';
import { CHECK_EMAIL_PATH, SIGN_IN_PATH } from '../paths.ts';
import { useTenantSlug } from '../tenant.ts';
import { EmailField, SubmitButton } from './fields.tsx';
import { Prompt } from './Prompt.tsx';
import { Screen } from './Screen.tsx';

function SignUp() {
  const slug = useTenantSlug();
  const navigate = useNavigate();
  const form = useSubmit(['email'], async (data) => {
    await callApi(startSignUp, { params: { slug }, body: { email: formText(data, 'email') } });
    navigate(CHECK_EMAIL_PATH);
  });

  return (
    <PageColumn>
      <PageIntro title="Create your account">
        <p>Enter your email address. We will email you a link to choose a password.</p>
      </PageIntro>
      <form noValidate onSubmit={form.onSubmit} className="flex max-w-md flex-col gap-6">
        <ErrorSummary key={form.attempt} errors={form.errors} />
        <EmailField error={form.errorFor('email')} />
        <SubmitButton pending={form.pending} label="Email me a link" pendingLabel="Sending…" />
      </form>
      <Prompt to={SIGN_IN_PATH} link="Sign in">
        Already have an account?
      </Prompt>
    </PageColumn>
  );
}

export default function SignUpPage() {
  return (
    <Screen kind="account">
      <SignUp />
    </Screen>
  );
}
