// SPDX-License-Identifier: AGPL-3.0-or-later

import { verifyBackupCode, verifyTotp } from '@pixel-scientists/domain/auth';
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
import { useState } from 'react';
import type { RefObject } from 'react';

import { callApi } from '../api.ts';
import { codeNotRight, refused } from './failures.ts';
import { useFocusOnChange } from './useFocusOnChange.ts';
import { Screen } from './Screen.tsx';

export const backupCodeNotRight =
  'That backup code is not right. Check it, or use a code you have not used before.';

/** Takes spaces, hyphens and capitals, and gives the code its one hyphen. */
function tidyBackupCode(text: string): string {
  const plain = text.replace(/[\s-]/g, '').toLowerCase();
  return plain.length === 10 ? `${plain.slice(0, 5)}-${plain.slice(5)}` : text.trim();
}

type Heading = RefObject<HTMLHeadingElement | null>;

function EnterBackupCode({ onUseApp, heading }: { onUseApp: () => void; heading: Heading }) {
  const { setSession, refresh } = useSession();
  const form = useSubmit(['code'], async (data) => {
    try {
      setSession(
        await callApi(verifyBackupCode, { body: { code: tidyBackupCode(formText(data, 'code')) } }),
      );
    } catch (error) {
      void refresh().catch(() => undefined);
      // One message for a wrong, used or badly formed code.
      throw refused(error, backupCodeNotRight);
    }
  });

  return (
    <>
      <PageHeading ref={heading}>Use a backup code</PageHeading>
      <p className="text-body text-muted">
        Enter one of the backup codes you saved. Each code works once.
      </p>
      <form noValidate onSubmit={form.onSubmit} className="flex flex-col gap-4">
        <ErrorSummary key={form.attempt} errors={form.errors} />
        <FormField id="code" label="Backup code" error={form.errorFor('code')}>
          <Input name="code" autoComplete="off" autoCapitalize="none" spellCheck={false} />
        </FormField>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" aria-disabled={form.pending || undefined}>
            Confirm backup code
          </Button>
          <Button onClick={onUseApp}>Use your authenticator app</Button>
        </div>
      </form>
    </>
  );
}

function EnterCode({ onUseBackup, heading }: { onUseBackup: () => void; heading: Heading }) {
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
      <PageHeading ref={heading}>Enter your code</PageHeading>
      <p className="text-body text-muted">
        Open your authenticator app and enter the 6-digit code it shows for this account.
      </p>
      <form noValidate onSubmit={form.onSubmit} className="flex flex-col gap-4">
        <ErrorSummary key={form.attempt} errors={form.errors} />
        <FormField id="code" label="Code from your app" error={form.errorFor('code')}>
          <Input name="code" inputMode="numeric" autoComplete="one-time-code" spellCheck={false} />
        </FormField>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" aria-disabled={form.pending || undefined}>
            Confirm code
          </Button>
          <Button onClick={onUseBackup}>Use a backup code</Button>
        </div>
      </form>
    </>
  );
}

export default function EnterCodePage() {
  const [backup, setBackup] = useState(false);
  // The two views swap in place, so focus follows to the new heading.
  const heading = useFocusOnChange<HTMLHeadingElement>(backup);
  return (
    <Screen kind="verify">
      {backup ? (
        <EnterBackupCode
          heading={heading}
          onUseApp={() => {
            setBackup(false);
          }}
        />
      ) : (
        <EnterCode
          heading={heading}
          onUseBackup={() => {
            setBackup(true);
          }}
        />
      )}
    </Screen>
  );
}
