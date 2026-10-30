// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The two fields of a decision, shared by the dialog for one and the dialog
// for many.

import { CurrencyInput, FormField, RadioGroup } from '@pixel-scientists/ui';
import type { ReactNode } from 'react';

import { outcomeIds, outcomes } from '../../contracts/index.ts';
import type { Outcome } from '../../contracts/index.ts';
import { isOutcome } from './draft.ts';

const options = outcomeIds.map((value) => ({
  value,
  label: outcomes[value],
  ...(value === 'accepted' && { hint: 'Offers a grant. You enter the amount next.' }),
}));

export interface OutcomeFieldProps {
  id: string;
  value: Outcome | '';
  onChange: (outcome: Outcome) => void;
  error: string | undefined;
}

export function OutcomeField({ id, value, onChange, error }: OutcomeFieldProps) {
  return (
    <RadioGroup
      id={id}
      legend="Outcome"
      name={id}
      value={value}
      onValueChange={(next) => {
        if (isOutcome(next)) onChange(next);
      }}
      options={options}
      error={error}
    />
  );
}

export interface AmountFieldProps {
  id: string;
  label: ReactNode;
  hint?: string;
  value: unknown;
  onChange: (amount: unknown) => void;
  error: string | undefined;
}

export function AmountField({ id, label, hint, value, onChange, error }: AmountFieldProps) {
  return (
    <FormField id={id} label={label} hint={hint} error={error}>
      <CurrencyInput value={value} onChange={onChange} />
    </FormField>
  );
}
