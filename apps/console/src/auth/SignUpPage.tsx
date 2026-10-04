// SPDX-License-Identifier: AGPL-3.0-or-later

import { startSignUp } from '@pixel-scientists/domain/auth';
import {
  Button,
  ErrorSummary,
  FormField,
  Input,
  Link,
  PageHeading,
  formText,
  useNavigate,
  useSubmit,
} from '@pixel-scientists/ui';

import { callApi } from '../api.ts';
import { useTenantSlug } from '../tenant.ts';
import { Screen } from './Screen.tsx';

function SignUp() {
  const slug = useTenantSlug();
  const navigate = useNavigate();
  const form = useSubmit(['email'], async (data) => {
    await callApi(startSignUp, { params: { slug }, body: { email: formText(data, 'email') } });
    navigate('/sign-up/check-email');
  });

  return (
    <>
      <PageHeading>Create your account</PageHeading>
      <p className="text-body text-muted">
        Enter your email address. We will email you a link to set your password.
      </p>
      <form noValidate onSubmit={form.onSubmit} className="flex flex-col gap-4">
        <ErrorSummary key={form.attempt} errors={form.errors} />
        <FormField id="email" label="Email address" error={form.errorFor('email')}>
          <Input
            name="email"
            type="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
          />
        </FormField>
        <div>
          <Button type="submit" variant="primary" aria-disabled={form.pending || undefined}>
            Email me a link
          </Button>
        </div>
      </form>
      <p className="text-body">
        Already have an account? <Link to="/sign-in">Sign in</Link>
      </p>
    </>
  );
}

export default function SignUpPage() {
  return (
    <Screen kind="account">
      <SignUp />
    </Screen>
  );
}
