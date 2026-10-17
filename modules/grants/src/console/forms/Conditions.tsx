// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Condition, FormField, Question } from '@pixel-scientists/domain/forms';
import { Button, FieldGroup, FormField as Field, Select } from '@pixel-scientists/ui';
import { useId } from 'react';

import { conditionAnswers } from './draft.ts';
import { Settings } from './Settings.tsx';
import type { Errors } from './Settings.tsx';

const same = (a: Condition, b: Condition) => JSON.stringify(a) === JSON.stringify(b);

const nameOf = (question: Question) =>
  question.label === '' ? 'Untitled question' : question.label;

/**
 * "Show this question only when…": each condition reads an earlier question
 * that has a choice or yes or no answer, and every condition must hold.
 */
export function Conditions({
  field,
  sources,
  errors,
  onChange,
}: {
  field: FormField;
  /** The questions before this one that a condition can read. */
  sources: readonly Question[];
  errors: Errors;
  onChange: (field: FormField) => void;
}) {
  const hintId = useId();
  const { conditions } = field;
  const change = (next: Condition[]) => {
    onChange({ ...field, conditions: next });
  };
  const replace = (index: number, condition: Condition) => {
    change(conditions.map((item, position) => (position === index ? condition : item)));
  };
  const first = sources[0];
  const none = first === undefined;
  const groupError = errors.get('conditions');

  return (
    <Settings heading="Show this question only when…">
      {conditions.length === 0 && (
        <p className="text-body text-muted">Applicants always see this question.</p>
      )}
      {conditions.map((condition, index) => {
        const source = sources.find((item) => item.id === condition.field);
        const answers = source === undefined ? [] : conditionAnswers(source);
        const answer = answers.findIndex((item) => same(item.condition, condition));
        const at = String(index);
        return (
          <FieldGroup key={index} legend={`Condition ${String(index + 1)}`}>
            <Field
              id={`field-conditions-${at}`}
              label="Earlier question"
              error={errors.get(`conditions.${at}.field`)}
            >
              <Select
                value={source?.id ?? ''}
                onChange={(event) => {
                  const next = sources.find((item) => item.id === event.currentTarget.value);
                  const start = next === undefined ? undefined : conditionAnswers(next)[0];
                  if (start !== undefined) replace(index, start.condition);
                }}
              >
                {source === undefined && <option value="">Choose a question</option>}
                {sources.map((item) => (
                  <option key={item.id} value={item.id}>
                    {nameOf(item)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              id={`field-conditions-${at}-answer`}
              label={source?.type === 'multiple_choice' ? 'Answer includes' : 'Answer is'}
              error={errors.get(`conditions.${at}`)}
            >
              <Select
                value={answer < 0 ? '' : String(answer)}
                onChange={(event) => {
                  const next = answers[Number(event.currentTarget.value)];
                  if (next !== undefined) replace(index, next.condition);
                }}
              >
                {answer < 0 && <option value="">Choose an answer</option>}
                {answers.map((item, position) => (
                  <option key={position} value={position}>
                    {item.label === '' ? `Choice ${String(position + 1)}` : item.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Button
              variant="quiet"
              className="self-start"
              onClick={() => {
                change(conditions.filter((_, position) => position !== index));
              }}
            >
              Remove<span className="sr-only"> condition {index + 1}</span>
            </Button>
          </FieldGroup>
        );
      })}
      {groupError !== undefined && (
        <p className="text-body font-medium text-danger">
          <span className="sr-only">Error:</span> {groupError}
        </p>
      )}
      <div className="flex flex-col items-start gap-1">
        <Button
          id="field-conditions-add"
          aria-disabled={none || undefined}
          aria-describedby={none ? hintId : undefined}
          onClick={() => {
            const start = first === undefined ? undefined : conditionAnswers(first)[0];
            if (start !== undefined) change([...conditions, start.condition]);
          }}
        >
          Add condition
        </Button>
        {none && (
          <p id={hintId} className="text-sm text-muted">
            Put a yes or no question or a choice question before this one to use its answer here.
          </p>
        )}
      </div>
    </Settings>
  );
}
