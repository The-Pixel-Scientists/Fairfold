// SPDX-License-Identifier: AGPL-3.0-or-later

import { signIn } from '@pixel-scientists/domain/auth';
import {
  Button,
  ErrorSummary,
  FormField,
  Input,
  Link,
  PageHeading,
  formText,
  useSession,
  useSubmit,
} from '@pixel-scientists/ui';

import { callApi } from '../api.ts';
import { useTenantSlug } from '../tenant.ts';
import { refused, signInFailed } from './failures.ts';
import { PasswordField } from './PasswordField.tsx';
import { usePageSearch } from './redirects.ts';
import type { Notice } from './redirects.ts';
import { Screen } from './Screen.tsx';

const FIELDS = ['email', 'password'] as const;

const noticeText: Record<Notice, string> = {
  timeout: 'You were signed out because your session ended. Sign in to carry on.',
  'account-created': 'Your account is ready. Sign in to start.',
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
      throw refused(error, signInFailed);
    }
  });

  return (
    <>
      <PageHeading>Sign in</PageHeading>
      {notice !== null && (
        <p className="rounded-md border border-divider bg-accent-soft p-3 text-body text-ink">
          {noticeText[notice]}
        </p>
      )}
      <form noValidate onSubmit={form.onSubmit} className="flex flex-col gap-4">
        <ErrorSummary key={form.attempt} errors={form.errors} />
        <FormField id="email" label="Email address" error={form.errorFor('email')}>
          <Input
            name="email"
            type="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
          />
        </FormField>
        <PasswordField autoComplete="current-password" error={form.errorFor('password')} />
        <div>
          <Button type="submit" variant="primary" aria-disabled={form.pending || undefined}>
            Sign in
          </Button>
        </div>
      </form>
      <p className="text-body">
        <Link to="/forgot-password">Forgot your password?</Link>
      </p>
      <p className="text-body">
        Do not have an account yet? <Link to="/sign-up">Create an account</Link>
      </p>
    </>
  );
}

export default function SignInPage() {
  return (
    <Screen kind="account">
      <SignIn />
    </Screen>
  );
}
