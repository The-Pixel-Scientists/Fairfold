// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';

import type { FieldProblemLike } from '../auth/problems.ts';
import { CheckboxGroup } from '../CheckboxGroup.tsx';
import { FormField, Input, Select, Textarea } from '../FormField.tsx';
import { RadioGroup } from '../RadioGroup.tsx';
import { AddressInput } from './AddressInput.tsx';
import { DateInput } from './DateInput.tsx';
import { CurrencyInput, NumberInput } from './NumberInput.tsx';
import { TextCount } from './TextCount.tsx';
import type { FormHelpers, QuestionDefinition } from './types.ts';

export interface QuestionProps {
  field: QuestionDefinition;
  /** The answer, whatever type it is. Anything that does not fit the field shows as empty. */
  value: unknown;
  /** The problems with this field and its parts, such as `f_address.postcode`. */
  problems: readonly FieldProblemLike[];
  /** Called with the new answer, or null when the person clears it. */
  onChange: (value: unknown) => void;
  helpers: Pick<FormHelpers, 'countWords' | 'countCharacters'>;
}

const YES_NO = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];

/** The question with its requirement in words, so it does not rest on a mark or a colour. */
function labelOf(field: QuestionDefinition): ReactNode {
  return (
    <>
      {field.label}{' '}
      <span className="font-normal text-muted">({field.required ? 'required' : 'optional'})</span>
    </>
  );
}

function selectionHint(field: QuestionDefinition & { type: 'multiple_choice' }): string {
  const { minSelections: min, maxSelections: max } = field;
  if (min !== undefined && max !== undefined)
    return `Choose from ${String(min)} to ${String(max)}.`;
  if (max !== undefined) return `Choose up to ${String(max)}.`;
  if (min !== undefined && min > 1) return `Choose at least ${String(min)}.`;
  return 'Choose all that apply.';
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * One question, as the control that suits its type, with its hint, its
 * requirement in words and its error. The control's id is the field's id, so
 * an error summary can link to it.
 */
export function Question({ field, value, problems, onChange, helpers }: QuestionProps) {
  const message = (key: string) => problems.find((problem) => problem.field === key)?.message;
  const error = message(field.id);
  const common = { id: field.id, label: labelOf(field), hint: field.hint, error };
  const onType = (event: { currentTarget: { value: string } }) => {
    onChange(event.currentTarget.value === '' ? null : event.currentTarget.value);
  };

  switch (field.type) {
    case 'short_text':
    case 'long_text': {
      const text = textOf(value);
      const hasCount = field.maxWords !== undefined || field.maxCharacters !== undefined;
      const countId = `${field.id}-count`;
      const control = {
        value: text,
        'aria-describedby': hasCount ? countId : undefined,
        onChange: onType,
      };
      return (
        <FormField {...common}>
          {field.type === 'short_text' ? (
            <Input {...control} />
          ) : (
            <Textarea rows={8} {...control} />
          )}
          {hasCount && (
            <TextCount
              id={countId}
              text={text}
              maxWords={field.maxWords}
              maxCharacters={field.maxCharacters}
              helpers={helpers}
            />
          )}
        </FormField>
      );
    }
    case 'number':
      return (
        <FormField {...common}>
          <NumberInput value={value} wholeNumber={field.wholeNumber} onChange={onChange} />
        </FormField>
      );
    case 'currency':
      return (
        <FormField {...common}>
          <CurrencyInput value={value} onChange={onChange} />
        </FormField>
      );
    case 'date':
      return (
        <DateInput
          id={field.id}
          legend={common.label}
          hint={field.hint}
          error={error}
          value={value}
          onChange={onChange}
        />
      );
    case 'email':
      return (
        <FormField {...common}>
          <Input
            type="email"
            autoComplete="email"
            spellCheck={false}
            value={textOf(value)}
            onChange={onType}
          />
        </FormField>
      );
    case 'phone':
      return (
        <FormField {...common}>
          <Input type="tel" autoComplete="tel" value={textOf(value)} onChange={onType} />
        </FormField>
      );
    case 'url':
      return (
        <FormField {...common}>
          <Input
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={textOf(value)}
            onChange={onType}
          />
        </FormField>
      );
    case 'single_choice':
      return (
        <RadioGroup
          id={field.id}
          name={field.id}
          legend={common.label}
          hint={field.hint}
          error={error}
          value={textOf(value)}
          onValueChange={onChange}
          options={field.options}
        />
      );
    case 'yes_no':
      return (
        <RadioGroup
          id={field.id}
          name={field.id}
          legend={common.label}
          hint={field.hint}
          error={error}
          value={typeof value === 'boolean' ? (value ? 'yes' : 'no') : ''}
          onValueChange={(chosen) => {
            onChange(chosen === 'yes');
          }}
          options={YES_NO}
        />
      );
    case 'multiple_choice':
      return (
        <CheckboxGroup
          id={field.id}
          name={field.id}
          legend={common.label}
          hint={
            <>
              {field.hint !== undefined && <span className="block">{field.hint}</span>}
              <span className="block">{selectionHint(field)}</span>
            </>
          }
          error={error}
          values={
            Array.isArray(value)
              ? (value as unknown[]).filter((item): item is string => typeof item === 'string')
              : []
          }
          onValuesChange={(chosen) => {
            onChange(chosen.length === 0 ? null : chosen);
          }}
          options={field.options}
        />
      );
    case 'dropdown':
      return (
        <FormField {...common}>
          <Select value={textOf(value)} onChange={onType}>
            <option value="">Choose an option</option>
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </FormField>
      );
    case 'uk_address':
      return (
        <AddressInput
          id={field.id}
          legend={common.label}
          hint={field.hint}
          error={error}
          partErrors={{
            line1: message(`${field.id}.line1`),
            town: message(`${field.id}.town`),
            postcode: message(`${field.id}.postcode`),
          }}
          value={value}
          onChange={onChange}
        />
      );
  }
}

/** Text for the applicant to read: paragraphs split at blank lines, and never read as markup. */
export function ContentBlock({ body }: { body: string }) {
  return (
    <div className="flex flex-col gap-3 text-body text-ink">
      {body.split(/\n{2,}/).map((paragraph, index) => (
        <p key={`${String(index)}:${paragraph}`} className="whitespace-pre-line">
          {paragraph}
        </p>
      ))}
    </div>
  );
}
