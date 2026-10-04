// SPDX-License-Identifier: AGPL-3.0-or-later

import { useId } from 'react';

import { Input, useFormFieldControl } from '../FormField.tsx';
import { amountAnswer, amountText, numberAnswer, numberText, POUND } from './numbers.ts';
import { useDraft } from './useDraft.ts';

interface InputProps {
  /** The answer: a number or an amount, or what was typed when it is neither. */
  value: unknown;
  onChange: (answer: unknown) => void;
}

/**
 * A number typed as text, not with the browser's spin box, which changes the
 * answer on a scroll and reads badly with a screen reader. Use it inside a
 * FormField.
 */
export function NumberInput({
  value,
  onChange,
  wholeNumber,
}: InputProps & { wholeNumber: boolean }) {
  const [text, setDraft] = useDraft(value, numberText);
  return (
    <Input
      value={text}
      inputMode={wholeNumber ? 'numeric' : 'decimal'}
      autoComplete="off"
      spellCheck={false}
      className="max-w-48"
      onChange={(event) => {
        const typed = event.currentTarget.value;
        const answer = numberAnswer(typed);
        setDraft(typed, answer);
        onChange(answer);
      }}
    />
  );
}

/**
 * An amount in pounds typed as text, held as pence. The £ sign is shown
 * beside the box and spoken as a description, and typing it is allowed. Use
 * it inside a FormField.
 */
export function CurrencyInput({ value, onChange }: InputProps) {
  const [text, setDraft] = useDraft(value, amountText);
  const generatedId = useId();
  const field = useFormFieldControl();
  const unitId = `${field?.id ?? generatedId}-unit`;
  return (
    <div className="flex items-center gap-2">
      <span aria-hidden="true" className="text-body text-ink">
        {POUND}
      </span>
      <Input
        value={text}
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        aria-describedby={unitId}
        className="max-w-48"
        onChange={(event) => {
          const typed = event.currentTarget.value;
          const answer = amountAnswer(typed);
          setDraft(typed, answer);
          onChange(answer);
        }}
      />
      <span id={unitId} className="sr-only">
        Amount in pounds
      </span>
    </div>
  );
}
