// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, FormField, Input } from '@pixel-scientists/ui';
import { useState } from 'react';

export interface EmailFieldProps {
  /** `username` on the sign-in form, so a password manager offers the saved address; `email` elsewhere. */
  autoComplete?: 'email' | 'username';
  error: string | undefined;
}

export function EmailField({ autoComplete = 'email', error }: EmailFieldProps) {
  return (
    <FormField id="email" label="Email address" error={error}>
      <Input
        name="email"
        type="email"
        autoComplete={autoComplete}
        autoCapitalize="none"
        spellCheck={false}
      />
    </FormField>
  );
}

export interface PasswordFieldProps {
  /** `current-password` to sign in, `new-password` to choose one. */
  autoComplete: 'current-password' | 'new-password';
  hint?: string;
  error: string | undefined;
}

/** A password field with a way to see what was typed, which helps most when there is no second field to repeat it in. */
export function PasswordField({ autoComplete, hint, error }: PasswordFieldProps) {
  const [shown, setShown] = useState(false);

  return (
    <FormField id="password" label="Password" hint={hint} error={error}>
      <Input
        name="password"
        type={shown ? 'text' : 'password'}
        autoComplete={autoComplete}
        autoCapitalize="none"
        spellCheck={false}
      />
      <label className="flex min-h-control items-center gap-3 text-body">
        <input
          type="checkbox"
          checked={shown}
          onChange={(event) => {
            setShown(event.target.checked);
          }}
          className="size-6 accent-accent"
        />
        Show password
      </label>
    </FormField>
  );
}

export interface SubmitButtonProps {
  pending: boolean;
  /** What pressing it does, such as "Create account". */
  label: string;
  /** What it says while the request is on its way, such as "Creating account…". */
  pendingLabel: string;
}

/**
 * The form's one main button. While the request is on its way it keeps focus
 * and says so, which matters most on a slow connection.
 */
export function SubmitButton({ pending, label, pendingLabel }: SubmitButtonProps) {
  return (
    <div>
      <Button
        type="submit"
        variant="primary"
        aria-disabled={pending || undefined}
        className="w-full sm:w-auto"
      >
        {pending ? pendingLabel : label}
      </Button>
    </div>
  );
}
