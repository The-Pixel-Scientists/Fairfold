// SPDX-License-Identifier: AGPL-3.0-or-later

import { Input, FormField } from '@pixel-scientists/ui';
import { useState } from 'react';
import type { ReactNode } from 'react';

/** What a person typed into a box that takes a whole number: nothing, or the digits. */
const wholeNumber = (text: string): number | undefined => {
  const digits = text.replace(/\D/g, '');
  return digits === '' ? undefined : Number(digits);
};

/** A group of settings under its own heading, set off from the ones above it. */
export function Settings({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 border-t border-divider pt-4">
      <h3 className="text-body font-semibold text-ink">{heading}</h3>
      {children}
    </div>
  );
}

/** A limit that is a whole number, or none at all. */
export function Limit({
  id,
  label,
  value,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: number | undefined;
  error: string | undefined;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <FormField id={id} label={label} optional error={error}>
      <Input
        value={value === undefined ? '' : String(value)}
        inputMode="numeric"
        autoComplete="off"
        className="max-w-32 tabular-nums"
        onChange={(event) => {
          onChange(wholeNumber(event.currentTarget.value));
        }}
      />
    </FormField>
  );
}

/**
 * A limit that is a whole number from 0 to `max`, which a question always has.
 * An empty box counts as 0, and the form's own rules say whether 0 will do.
 */
export function Count({
  id,
  label,
  hint,
  value,
  max,
  error,
  onChange,
}: {
  id: string;
  label: ReactNode;
  hint?: string;
  value: number;
  max: number;
  error: string | undefined;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  // What was typed stays as typed while it means the value; a value set from elsewhere replaces it.
  const shown = (text === '' ? 0 : Number(text)) === value ? text : String(value);
  return (
    <FormField id={id} label={label} hint={hint} error={error}>
      <Input
        value={shown}
        inputMode="numeric"
        autoComplete="off"
        className="max-w-32 tabular-nums"
        onChange={(event) => {
          const digits = event.currentTarget.value.replace(/\D/g, '');
          const next = digits === '' ? '' : String(Math.min(Number(digits), max));
          setText(next);
          onChange(next === '' ? 0 : Number(next));
        }}
      />
    </FormField>
  );
}

export type Errors = ReadonlyMap<string, string>;
