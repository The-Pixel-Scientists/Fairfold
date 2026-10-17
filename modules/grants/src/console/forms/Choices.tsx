// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, FormField, Input } from '@pixel-scientists/ui';
import { useEffect, useRef } from 'react';

import { newChoice, withoutChoice } from './draft.ts';
import type { ChoiceQuestion } from './draft.ts';
import { Limit, Settings } from './Settings.tsx';
import type { Errors } from './Settings.tsx';

const MIN_CHOICES = 2;

/** The choices of a choice question, with the fewest and most an applicant may tick when they can tick several. */
export function Choices({
  question,
  errors,
  onChange,
}: {
  question: ChoiceQuestion;
  errors: Errors;
  onChange: (question: ChoiceQuestion) => void;
}) {
  const { options } = question;
  const focus = useRef<string | null>(null);

  useEffect(() => {
    if (focus.current === null) return;
    document.getElementById(focus.current)?.focus();
    focus.current = null;
  }, [options.length]);

  return (
    <Settings heading="Choices">
      <div className="flex flex-col gap-3">
        {errors.has('options') && (
          <p className="text-body font-medium text-danger">
            <span className="sr-only">Error:</span> {errors.get('options')}
          </p>
        )}
        {options.map((choice, index) => (
          <div key={choice.value} className="flex flex-wrap items-end gap-x-2 gap-y-1">
            <FormField
              id={`field-options-${String(index)}-label`}
              label={`Choice ${String(index + 1)}`}
              error={errors.get(`options.${String(index)}.label`)}
              className="min-w-40 flex-1"
            >
              <Input
                value={choice.label}
                autoComplete="off"
                onChange={(event) => {
                  const label = event.currentTarget.value;
                  onChange({
                    ...question,
                    options: options.map((item) =>
                      item.value === choice.value ? { ...item, label } : item,
                    ),
                  });
                }}
              />
            </FormField>
            <Button
              variant="quiet"
              aria-disabled={options.length <= MIN_CHOICES || undefined}
              onClick={() => {
                if (options.length <= MIN_CHOICES) return;
                focus.current = 'field-options-add';
                onChange(withoutChoice(question, choice.value));
              }}
            >
              Remove<span className="sr-only"> choice {index + 1}</span>
            </Button>
          </div>
        ))}
        <Button
          id="field-options-add"
          className="self-start"
          onClick={() => {
            focus.current = `field-options-${String(options.length)}-label`;
            onChange({ ...question, options: [...options, newChoice()] });
          }}
        >
          Add choice
        </Button>
        <p className="text-sm text-muted">A question needs at least {MIN_CHOICES} choices.</p>
      </div>
      {question.type === 'multiple_choice' && (
        <div className="grid grid-cols-2 gap-3">
          <Limit
            id="field-minSelections"
            label="Fewest choices"
            value={question.minSelections}
            error={errors.get('minSelections')}
            onChange={(minSelections) => {
              onChange({ ...question, minSelections });
            }}
          />
          <Limit
            id="field-maxSelections"
            label="Most choices"
            value={question.maxSelections}
            error={errors.get('maxSelections')}
            onChange={(maxSelections) => {
              onChange({ ...question, maxSelections });
            }}
          />
        </div>
      )}
    </Settings>
  );
}
