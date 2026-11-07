// SPDX-License-Identifier: AGPL-3.0-or-later

import { changePassword } from '@pixel-scientists/domain/auth';
import { Button, ErrorSummary, formText, useSubmit } from '@pixel-scientists/ui';
import { useRef, useState } from 'react';

import { callApi } from '../../api.ts';
import { PasswordField } from '../../auth/PasswordField.tsx';
import type { StepUp } from '../../platform/team/useStepUp.tsx';
import { Result, Section, focusWhenSettled } from './parts.tsx';

export function PasswordSection({ stepUp }: { stepUp: StepUp }) {
  const [message, setMessage] = useState('');
  const [version, setVersion] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const form = useSubmit(['password'], async (data) => {
    const changed = await stepUp.run(async () => {
      await callApi(changePassword, { body: { password: formText(data, 'password') } });
      return true;
    });
    if (changed === null) return;
    setMessage('Your password has changed. Anywhere else you were signed in is signed out.');
    // A new form drops what was typed.
    setVersion((current) => current + 1);
    focusWhenSettled(heading);
  });

  return (
    <Section id="password-section" title="Password" headingRef={heading}>
      <Result>{message}</Result>
      <form
        key={version}
        noValidate
        onSubmit={form.onSubmit}
        className="flex flex-col gap-3 sm:max-w-md"
      >
        <ErrorSummary key={form.attempt} errors={form.errors} />
        <PasswordField
          autoComplete="new-password"
          hint="At least 12 characters. A few words together is easy to remember and hard to guess."
          error={form.errorFor('password')}
        />
        <div>
          <Button type="submit" aria-disabled={form.pending || undefined}>
            Change password
          </Button>
        </div>
      </form>
    </Section>
  );
}
