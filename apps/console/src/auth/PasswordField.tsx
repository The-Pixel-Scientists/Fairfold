// SPDX-License-Identifier: AGPL-3.0-or-later

import { FormField, Input } from '@pixel-scientists/ui';
import { useState } from 'react';

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
      <label className="flex min-h-target items-center gap-2 text-body">
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
