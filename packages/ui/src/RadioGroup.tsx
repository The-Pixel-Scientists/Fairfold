// SPDX-License-Identifier: AGPL-3.0-or-later

import { useId } from 'react';
import type { ReactNode } from 'react';

import { FieldGroup } from './FieldGroup.tsx';

export interface RadioOption {
  value: string;
  /** What choosing it does or means, in a few words. */
  label: ReactNode;
  /** More about the choice, read with its label. */
  hint?: ReactNode;
}

export interface RadioGroupProps {
  /** The question, which names the group. */
  legend: ReactNode;
  /** Groups the radio buttons, and is the name a form sends. */
  name: string;
  value: string;
  onValueChange: (value: string) => void;
  options: readonly RadioOption[];
  /** Help that applies before the person chooses. */
  hint?: ReactNode;
  /** What went wrong and how to fix it. Leave it out when the choice is valid. */
  error?: ReactNode;
  /** The id of the first radio button, so an ErrorSummary can link to it. Generated when left out. */
  id?: string;
  className?: string;
}

/**
 * A question with a few answers, shown together, where the person picks one.
 * Radio buttons are the browser's own: Tab moves into and out of the group,
 * and the arrow keys move between its choices. The legend names the group
 * and its hint and error describe it. Each radio button is 24px across.
 */
export function RadioGroup({
  legend,
  name,
  value,
  onValueChange,
  options,
  hint,
  error,
  id,
  className,
}: RadioGroupProps) {
  const generatedId = useId();
  const baseId = id ?? generatedId;
  const inputId = (index: number) => (index === 0 ? baseId : `${baseId}-${String(index)}`);

  return (
    <FieldGroup legend={legend} hint={hint} error={error} id={baseId} className={className}>
      {options.map((option, index) => {
        const optionHintId = `${baseId}-option-${String(index)}`;
        return (
          <div key={option.value} className="flex min-h-target items-start gap-2 text-body">
            <input
              id={inputId(index)}
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              aria-describedby={option.hint === undefined ? undefined : optionHintId}
              onChange={() => {
                onValueChange(option.value);
              }}
              className="size-6 shrink-0 accent-accent"
            />
            <div className="flex flex-col pt-0.5">
              <label htmlFor={inputId(index)} className="text-ink">
                {option.label}
              </label>
              {option.hint !== undefined && (
                <span id={optionHintId} className="text-muted">
                  {option.hint}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </FieldGroup>
  );
}
