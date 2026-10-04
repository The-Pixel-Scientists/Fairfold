// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Definitions and a harness shared by the form components' tests. The
// harness keeps the answers, as an app would. Not exported from the package.

import { useState } from 'react';
import type { ComponentProps } from 'react';

import { FormSection } from '../src/forms/FormSection.tsx';
import type { FormFieldDefinition, FormHelpers, QuestionDefinition } from '../src/forms/types.ts';

/** Counts as the engine does, so the live count is the one the server checks. */
export const helpers: FormHelpers = {
  countWords: (text) => text.split(/\s+/u).filter((word) => /[\p{L}\p{N}]/u.test(word)).length,
  countCharacters: (text) => Array.from(text).length,
  formatMoney: ({ amountMinor }) => `£${(amountMinor / 100).toLocaleString('en-GB')}`,
};

/** A question with the fields every question has. Name the id and type, and add what the type needs. */
export function question(
  field: { id: string; type: QuestionDefinition['type'] } & Record<string, unknown>,
): QuestionDefinition {
  return { label: `Question ${field.id}`, required: false, ...field } as QuestionDefinition;
}

type SectionProps = ComponentProps<typeof FormSection>;

interface HarnessProps extends Partial<Omit<SectionProps, 'section' | 'answers' | 'onChange'>> {
  fields: readonly FormFieldDefinition[];
  answers?: Record<string, unknown>;
  /** Called with each change, after the harness has kept it. */
  onAnswer?: (fieldId: string, value: unknown) => void;
}

export function SectionHarness({
  fields,
  answers: initial = {},
  onAnswer,
  visible,
  ...rest
}: HarnessProps) {
  const [answers, setAnswers] = useState(initial);
  return (
    <FormSection
      section={{ id: 's_one', title: 'About you', introduction: 'Tell us about you.', fields }}
      visible={visible ?? fields}
      answers={answers}
      onChange={(fieldId, value) => {
        setAnswers((current) => ({ ...current, [fieldId]: value }));
        onAnswer?.(fieldId, value);
      }}
      helpers={helpers}
      {...rest}
    />
  );
}
