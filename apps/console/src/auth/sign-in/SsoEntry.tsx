// SPDX-License-Identifier: AGPL-3.0-or-later

import { startSso } from '@pixel-scientists/domain/auth';
import { Button, ErrorSummary, FormField, Input, formText, useSubmit } from '@pixel-scientists/ui';
import { useState } from 'react';

import { callApi } from '../../api.ts';
import { useTenantSlug } from '../../tenant.ts';
import { leaveFor } from './leave.ts';

const FIELDS = ['ssoEmail'] as const;

const notStarted =
  'We could not start single sign-on for that address. Check it, or sign in with your password.';

/**
 * Sign-in through the funder's own identity provider. The email goes in the
 * request body only. The answer is the same whether or not a domain matches,
 * and the browser goes to the address the server gives, as it is.
 */
export function SsoEntry() {
  const slug = useTenantSlug();
  const [message, setMessage] = useState('');
  const form = useSubmit(FIELDS, async (data) => {
    setMessage('');
    const { url } = await callApi(startSso, {
      params: { slug },
      body: { email: formText(data, 'ssoEmail').trim() },
    });
    if (url === null) setMessage(notStarted);
    else leaveFor(url);
  });

  return (
    <section
      aria-labelledby="sso-heading"
      className="flex flex-col gap-3 border-t border-divider pt-4"
    >
      <h2 id="sso-heading" className="text-lg font-semibold tracking-tight text-ink">
        Sign in through your organisation
      </h2>
      <form noValidate onSubmit={form.onSubmit} className="flex flex-col gap-4">
        <ErrorSummary key={form.attempt} errors={form.errors} />
        <FormField id="ssoEmail" label="Work email address" error={form.errorFor('ssoEmail')}>
          <Input
            name="ssoEmail"
            type="email"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
          />
        </FormField>
        <p role="status" className="text-body text-muted">
          {message}
        </p>
        <div>
          <Button type="submit" aria-disabled={form.pending || undefined}>
            Continue with your organisation&apos;s sign-in
          </Button>
        </div>
      </form>
    </section>
  );
}
