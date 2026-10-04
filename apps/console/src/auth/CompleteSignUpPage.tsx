// SPDX-License-Identifier: AGPL-3.0-or-later

import { completeSignUp, tokenSchema } from '@pixel-scientists/domain/auth';
import {
  Button,
  ErrorSummary,
  Link,
  PageHeading,
  formText,
  useNavigate,
  useSubmit,
} from '@pixel-scientists/ui';

import { callApi } from '../api.ts';
import { LinkNotValid } from './LinkNotValid.tsx';
import { PasswordField } from './PasswordField.tsx';
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
    navigate(withQuery('/sign-in', null, 'account-created'));
  });

  if (token === null || !tokenSchema.safeParse(token).success) {
    return <LinkNotValid askAgainTo="/sign-up" />;
  }

  return (
    <>
      <PageHeading>Set your password</PageHeading>
      <p className="text-body text-muted">
        Your email address is confirmed. Choose a password to finish creating your account.
      </p>
      <form noValidate onSubmit={form.onSubmit} className="flex flex-col gap-4">
        <ErrorSummary key={form.attempt} errors={form.errors} />
        <PasswordField
          autoComplete="new-password"
          hint="At least 12 characters. A few words together is easy to remember and hard to guess."
          error={form.errorFor('password')}
        />
        <div>
          <Button type="submit" variant="primary" aria-disabled={form.pending || undefined}>
            Create account
          </Button>
        </div>
      </form>
      <p className="text-body">
        Is the link not working? <Link to="/sign-up">Ask for a new one</Link>
      </p>
    </>
  );
}

export default function CompleteSignUpPage() {
  return (
    <Screen kind="account">
      <CompleteSignUp />
    </Screen>
  );
}
