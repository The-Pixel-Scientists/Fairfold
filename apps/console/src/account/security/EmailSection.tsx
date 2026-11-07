// SPDX-License-Identifier: AGPL-3.0-or-later

import { requestEmailChange } from '@pixel-scientists/domain/auth';
import { Button, ErrorSummary, FormField, Input, formText, useSubmit } from '@pixel-scientists/ui';
import { useRef, useState } from 'react';

import { callApi } from '../../api.ts';
import type { StepUp } from '../../platform/team/useStepUp.tsx';
import { Result, Section, focusWhenSettled } from './parts.tsx';

/** The same words whether or not the address already has an account. */
export const checkYourEmail =
  'Check your email. If the address can be used, we have sent it a link to confirm the change.';

export function EmailSection({ stepUp }: { stepUp: StepUp }) {
  const [message, setMessage] = useState('');
  const [version, setVersion] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const form = useSubmit(['email'], async (data) => {
    const sent = await stepUp.run(async () => {
      await callApi(requestEmailChange, { body: { email: formText(data, 'email') } });
      return true;
    });
    if (sent === null) return;
    setMessage(checkYourEmail);
    setVersion((current) => current + 1);
    focusWhenSettled(heading);
  });

  return (
    <Section id="email-section" title="Email address" headingRef={heading}>
      <p className="text-body text-muted">
        We send a link to the new address. Your address changes when you open it.
      </p>
      <Result>{message}</Result>
      <form
        key={version}
        noValidate
        onSubmit={form.onSubmit}
        className="flex flex-col gap-3 sm:max-w-md"
      >
        <ErrorSummary key={form.attempt} errors={form.errors} />
        <FormField id="email" label="New email address" error={form.errorFor('email')}>
          <Input name="email" type="email" autoComplete="email" spellCheck={false} />
        </FormField>
        <div>
          <Button type="submit" aria-disabled={form.pending || undefined}>
            Change email address
          </Button>
        </div>
      </form>
    </Section>
  );
}
