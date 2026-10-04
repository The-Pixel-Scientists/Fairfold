// SPDX-License-Identifier: AGPL-3.0-or-later

import { useId } from 'react';
import type { ReactNode } from 'react';

import { FieldGroup } from './FieldGroup.tsx';

export interface CheckboxOption {
  value: string;
  /** What ticking it means, in a few words. */
  label: ReactNode;
}

export interface CheckboxGroupProps {
  /** The question, which names the group. */
  legend: ReactNode;
  /** The name a form sends with each ticked value. */
  name: string;
  /** The values ticked now. */
  values: readonly string[];
  /** Called with the values ticked after a change, in the order of `options`. */
  onValuesChange: (values: string[]) => void;
  options: readonly CheckboxOption[];
  /** Help that applies before the person chooses, such as how many they may tick. */
  hint?: ReactNode;
  /** What went wrong and how to fix it. Leave it out when the choice is valid. */
  error?: ReactNode;
  /** The id of the first checkbox, so an ErrorSummary can link to it. Generated when left out. */
  id?: string;
  className?: string;
}

/**
 * A question with several answers, shown together, where the person ticks
 * any that apply. The checkboxes are the browser's own, each reached with Tab
 * and ticked with Space, and each 24px across. The legend names the group and
 * its hint and error describe it.
 */
export function CheckboxGroup({
  legend,
  name,
  values,
  onValuesChange,
  options,
  hint,
  error,
  id,
  className,
}: CheckboxGroupProps) {
  const generatedId = useId();
  const baseId = id ?? generatedId;
  const inputId = (index: number) => (index === 0 ? baseId : `${baseId}-${String(index)}`);

  function toggle(value: string, ticked: boolean) {
    const next = new Set(values);
    if (ticked) next.add(value);
    else next.delete(value);
    onValuesChange(options.map((option) => option.value).filter((item) => next.has(item)));
  }

  return (
    <FieldGroup legend={legend} hint={hint} error={error} id={baseId} className={className}>
      {options.map((option, index) => (
        <div key={option.value} className="flex min-h-target items-start gap-2 text-body">
          <input
            id={inputId(index)}
            type="checkbox"
            name={name}
            value={option.value}
            checked={values.includes(option.value)}
            onChange={(event) => {
              toggle(option.value, event.currentTarget.checked);
            }}
            className="size-6 shrink-0 accent-accent"
          />
          <label htmlFor={inputId(index)} className="pt-0.5 text-ink">
            {option.label}
          </label>
        </div>
      ))}
    </FieldGroup>
  );
}
