// SPDX-License-Identifier: AGPL-3.0-or-later

import { verifyTotp } from '@pixel-scientists/domain/auth';
import {
  Button,
  ErrorSummary,
  FormField,
  Input,
  PageHeading,
  formText,
  useSession,
  useSubmit,
} from '@pixel-scientists/ui';

import { callApi } from '../api.ts';
import { codeNotRight, refused } from './failures.ts';
import { Screen } from './Screen.tsx';

function EnterCode() {
  const { setSession, refresh } = useSession();
  const form = useSubmit(['code'], async (data) => {
    try {
      setSession(await callApi(verifyTotp, { body: { code: formText(data, 'code') } }));
    } catch (error) {
      // After too many wrong codes the session is gone, which sends the person back to sign in.
      void refresh().catch(() => undefined);
      throw refused(error, codeNotRight);
    }
  });

  return (
    <>
      <PageHeading>Enter your code</PageHeading>
      <p className="text-body text-muted">
        Open your authenticator app and enter the 6-digit code it shows for this account.
      </p>
      <form noValidate onSubmit={form.onSubmit} className="flex flex-col gap-4">
        <ErrorSummary key={form.attempt} errors={form.errors} />
        <FormField id="code" label="Code from your app" error={form.errorFor('code')}>
          <Input name="code" inputMode="numeric" autoComplete="one-time-code" spellCheck={false} />
        </FormField>
        <div>
          <Button type="submit" variant="primary" aria-disabled={form.pending || undefined}>
            Confirm code
          </Button>
        </div>
      </form>
    </>
  );
}

export default function EnterCodePage() {
  return (
    <Screen kind="verify">
      <EnterCode />
    </Screen>
  );
}
