// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';

import type {
  FormAnswers,
  FormFieldDefinition,
  FormHelpers,
  FormMoney,
  FormSectionDefinition,
  QuestionDefinition,
  VisibleFields,
} from './types.ts';

export interface AnswerViewProps {
  sections: readonly FormSectionDefinition[];
  /**
   * The fields to show. For staff and reviewers these are the fields their
   * audience may see: nothing is hidden here, so a field that is not listed
   * leaves no label, no empty answer and no trace.
   */
  visible: VisibleFields;
  /** The answers to those fields, as the server projected them for this person. */
  answers: FormAnswers;
  helpers: Pick<FormHelpers, 'formatMoney'>;
  /** The heading level of each section's title. Defaults to h3. */
  headingLevel?: 'h2' | 'h3' | 'h4';
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ADDRESS_PARTS = ['line1', 'line2', 'town', 'county', 'postcode'];
const dateFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' });
const numberFormat = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 20 });

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isMoney(value: unknown): value is FormMoney {
  const { amountMinor, currency } = (
    typeof value === 'object' && value !== null ? value : {}
  ) as Partial<FormMoney>;
  return typeof amountMinor === 'number' && currency === 'GBP';
}

function lines(items: readonly string[]): ReactNode {
  return items.map((item, index) => (
    <span key={`${String(index)}:${item}`} className="block break-words">
      {item}
    </span>
  ));
}

function dateText(value: string): string {
  const match = ISO_DATE.exec(value);
  if (match === null) return value;
  const [year, month, day] = match.slice(1).map(Number) as [number, number, number];
  return dateFormat.format(Date.UTC(year, month - 1, day));
}

function addressLines(value: unknown): string[] {
  const address =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  return ADDRESS_PARTS.map((part) => address[part]).filter(isText);
}

/** What an answer says, or null when there is no answer. Anything that does not fit its field is no answer. */
function answerText(
  field: QuestionDefinition,
  value: unknown,
  helpers: AnswerViewProps['helpers'],
): ReactNode {
  switch (field.type) {
    case 'short_text':
    case 'long_text':
    case 'email':
    case 'phone':
    case 'url':
      return isText(value) ? (
        <span className="block whitespace-pre-line break-words">{value}</span>
      ) : null;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? numberFormat.format(value)
        : null;
    case 'currency':
      return isMoney(value) ? helpers.formatMoney(value) : null;
    case 'date':
      return isText(value) ? dateText(value) : null;
    case 'yes_no':
      return typeof value === 'boolean' ? (value ? 'Yes' : 'No') : null;
    case 'single_choice':
    case 'dropdown':
      return isText(value)
        ? (field.options.find((option) => option.value === value)?.label ?? value)
        : null;
    case 'multiple_choice': {
      const chosen = Array.isArray(value) ? (value as unknown[]).filter(isText) : [];
      if (chosen.length === 0) return null;
      return (
        <ul className="list-disc pl-5">
          {chosen.map((item) => (
            <li key={item}>
              {field.options.find((option) => option.value === item)?.label ?? item}
            </li>
          ))}
        </ul>
      );
    }
    case 'uk_address': {
      const address = addressLines(value);
      return address.length === 0 ? null : lines(address);
    }
  }
}

function isQuestion(field: FormFieldDefinition): field is QuestionDefinition {
  return field.type !== 'content';
}

/**
 * Answers to read, not to change: each section's title, then each question
 * with its answer, or "Not answered". It shows only the fields it is given
 * and only their answers, so what the server did not send, such as an
 * identity field in blind review, cannot appear. Sections with nothing to
 * show are left out.
 */
export function AnswerView({
  sections,
  visible,
  answers,
  helpers,
  headingLevel: Heading = 'h3',
}: AnswerViewProps) {
  const shown = new Set(visible.map((field) => field.id));

  return (
    <div className="flex flex-col gap-stack">
      {sections.map((section) => {
        const questions = section.fields.filter(isQuestion).filter((field) => shown.has(field.id));
        if (questions.length === 0) return null;
        return (
          <div key={section.id} className="flex flex-col gap-2">
            <Heading className="text-lg font-semibold text-ink">{section.title}</Heading>
            <dl className="flex flex-col divide-y divide-divider">
              {questions.map((field) => {
                const answer = answerText(
                  field,
                  Object.hasOwn(answers, field.id) ? answers[field.id] : null,
                  helpers,
                );
                return (
                  <div
                    key={field.id}
                    className="flex flex-col gap-1 py-2 sm:grid sm:grid-cols-3 sm:gap-gutter"
                  >
                    <dt className="break-words text-body text-muted">{field.label}</dt>
                    <dd className="text-body text-ink sm:col-span-2">
                      {answer ?? <span className="text-muted">Not answered</span>}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        );
      })}
    </div>
  );
}
