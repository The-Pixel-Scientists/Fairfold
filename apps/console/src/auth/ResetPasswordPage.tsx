// SPDX-License-Identifier: AGPL-3.0-or-later

import { completePasswordReset, tokenSchema } from '@pixel-scientists/domain/auth';
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

function ResetPassword() {
  const token = useFragmentToken();
  const navigate = useNavigate();
  const form = useSubmit(['password'], async (data) => {
    await callApi(completePasswordReset, {
      body: { token: token ?? '', password: formText(data, 'password') },
    });
    navigate(withQuery('/sign-in', null, 'password-reset'));
  });

  if (token === null || !tokenSchema.safeParse(token).success) {
    return <LinkNotValid askAgainTo="/forgot-password" />;
  }

  return (
    <>
      <PageHeading>Choose a new password</PageHeading>
      <p className="text-body text-muted">
        You will sign in with this password from now on. Anywhere else you are signed in will be
        signed out.
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
            Save new password
          </Button>
        </div>
      </form>
      <p className="text-body">
        Is the link not working? <Link to="/forgot-password">Ask for a new one</Link>
      </p>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <Screen kind="account">
      <ResetPassword />
    </Screen>
  );
}
