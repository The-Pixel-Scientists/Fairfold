// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';

import { FieldGroup } from '../FieldGroup.tsx';
import { Input } from '../FormField.tsx';
import { cx } from '../cx.ts';
import { dateAnswer, dateParts } from './dates.ts';
import type { DateParts } from './dates.ts';
import { useDraft } from './useDraft.ts';

export interface DateInputProps {
  /** The question, which names the group. */
  legend: ReactNode;
  /** The id of the day box; the month and year boxes add `-month` and `-year`. */
  id: string;
  hint?: ReactNode;
  error?: ReactNode;
  /** The date as 2027-03-27, or what was typed when it is not a real date. */
  value: unknown;
  onChange: (answer: string | null) => void;
}

const BOXES = [
  { part: 'day', label: 'Day', suffix: '', width: 'w-16' },
  { part: 'month', label: 'Month', suffix: '-month', width: 'w-16' },
  { part: 'year', label: 'Year', suffix: '-year', width: 'w-24' },
] as const;

/**
 * A date in three boxes, for day, month and year. It is easier to get right
 * than a calendar picker, and it works the same with every screen reader.
 */
export function DateInput({ legend, id, hint, error, value, onChange }: DateInputProps) {
  const [parts, setDraft] = useDraft<DateParts>(value, dateParts);

  function change(part: keyof DateParts, typed: string) {
    const next = { ...parts, [part]: typed };
    const answer = dateAnswer(next);
    setDraft(next, answer);
    onChange(answer);
  }

  return (
    <FieldGroup
      legend={legend}
      id={id}
      error={error}
      hint={
        <>
          {hint !== undefined && <span className="block">{hint}</span>}
          <span className="block">For example, 27 3 2027</span>
        </>
      }
    >
      <div className="flex flex-wrap gap-3">
        {BOXES.map(({ part, label, suffix, width }) => (
          <div key={part} className={cx('flex flex-col gap-field-gap', width)}>
            <label htmlFor={`${id}${suffix}`} className="text-body text-ink">
              {label}
            </label>
            <Input
              id={`${id}${suffix}`}
              value={parts[part]}
              inputMode="numeric"
              autoComplete="off"
              aria-invalid={error === undefined ? undefined : true}
              onChange={(event) => {
                change(part, event.currentTarget.value);
              }}
            />
          </div>
        ))}
      </div>
    </FieldGroup>
  );
}
