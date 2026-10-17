// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, FormField, Input } from '@pixel-scientists/ui';
import { useEffect, useRef } from 'react';

import { newChoice, withoutChoice } from './draft.ts';
import type { Choice, ChoiceQuestion } from './draft.ts';
import { Limit, Settings } from './Settings.tsx';
import type { Errors } from './Settings.tsx';

const MIN_CHOICES = 2;

/**
 * The choices of a question or a table column, one box each, with buttons to
 * add and remove them. `path` is where they sit in the form, such as
 * `options` or `columns.1.options`: it names the boxes and finds their errors.
 */
export function OptionList({
  options,
  path,
  noun,
  errors,
  onChange,
  onRemove,
}: {
  options: readonly Choice[];
  path: string;
  /** What has the choices, for "A question needs at least 2 choices". */
  noun: 'question' | 'column';
  errors: Errors;
  onChange: (options: Choice[]) => void;
  onRemove: (value: string) => void;
}) {
  const id = `field-${path.replaceAll('.', '-')}`;
  const focus = useRef<string | null>(null);

  useEffect(() => {
    if (focus.current === null) return;
    document.getElementById(focus.current)?.focus();
    focus.current = null;
  }, [options.length]);

  return (
    <div className="flex flex-col gap-3">
      {errors.has(path) && (
        <p className="text-body font-medium text-danger">
          <span className="sr-only">Error:</span> {errors.get(path)}
        </p>
      )}
      {options.map((choice, index) => (
        <div key={choice.value} className="flex flex-wrap items-end gap-x-2 gap-y-1">
          <FormField
            id={`${id}-${String(index)}-label`}
            label={`Choice ${String(index + 1)}`}
            error={errors.get(`${path}.${String(index)}.label`)}
            className="min-w-40 flex-1"
          >
            <Input
              value={choice.label}
              autoComplete="off"
              onChange={(event) => {
                const label = event.currentTarget.value;
                onChange(
                  options.map((item) => (item.value === choice.value ? { ...item, label } : item)),
                );
              }}
            />
          </FormField>
          <Button
            variant="quiet"
            aria-disabled={options.length <= MIN_CHOICES || undefined}
            onClick={() => {
              if (options.length <= MIN_CHOICES) return;
              focus.current = `${id}-add`;
              onRemove(choice.value);
            }}
          >
            Remove<span className="sr-only"> choice {index + 1}</span>
          </Button>
        </div>
      ))}
      <Button
        id={`${id}-add`}
        className="self-start"
        onClick={() => {
          focus.current = `${id}-${String(options.length)}-label`;
          onChange([...options, newChoice()]);
        }}
      >
        Add choice
      </Button>
      <p className="text-sm text-muted">
        A {noun} needs at least {MIN_CHOICES} choices.
      </p>
    </div>
  );
}

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
  return (
    <Settings heading="Choices">
      <OptionList
        options={question.options}
        path="options"
        noun="question"
        errors={errors}
        onChange={(options) => {
          onChange({ ...question, options });
        }}
        onRemove={(value) => {
          onChange(withoutChoice(question, value));
        }}
      />
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
