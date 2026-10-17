// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Definitions and a harness shared by the form components' tests. The
// harness keeps the answers, as an app would. Not exported from the package.

import { useState } from 'react';
import type { ComponentProps } from 'react';

import { FormSection } from '../src/forms/FormSection.tsx';
import type {
  FileHelpers,
  FormFieldDefinition,
  FormHelpers,
  FormMoney,
  QuestionDefinition,
} from '../src/forms/types.ts';

/** Counts and totals as the engine does, so what people see is what the server checks. */
export const helpers: FormHelpers = {
  countWords: (text) => text.split(/\s+/u).filter((word) => /[\p{L}\p{N}]/u.test(word)).length,
  countCharacters: (text) => Array.from(text).length,
  formatMoney: ({ amountMinor }) => `£${(amountMinor / 100).toLocaleString('en-GB')}`,
  // Blank cells count as nothing; a cell that is not a figure leaves its column with no total.
  tableTotals: (field, rows) => {
    const totals: Record<string, number | FormMoney | null> = {};
    for (const column of field.columns) {
      if ((column.type !== 'number' && column.type !== 'currency') || column.total !== true) {
        continue;
      }
      let sum: number | null = 0;
      for (const row of rows) {
        const cell = row[column.id];
        if (cell === null || cell === undefined) continue;
        const figure = column.type === 'number' ? cell : (cell as Partial<FormMoney>).amountMinor;
        sum = typeof figure === 'number' && sum !== null ? sum + figure : null;
      }
      totals[column.id] =
        column.type === 'currency' && sum !== null ? { amountMinor: sum, currency: 'GBP' } : sum;
    }
    return totals;
  },
};

/** File checks as the engine makes them, for a form that takes PDF and Word documents. */
export const fileHelpers: FileHelpers = {
  fileTypeLabels: {
    'application/pdf': 'PDF',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word document',
  },
  // Only the first bytes, as the engine does for a PDF: the name and the declared type say nothing.
  sniffFileType: (bytes) =>
    new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-' ? 'application/pdf' : null,
  checkFile: (field, { bytes, type }) => {
    if (bytes > field.maxBytes) return 'The file must be 10 MB or smaller.';
    return type === null || !field.allowedTypes.includes(type)
      ? 'The file must be a PDF or Word document.'
      : undefined;
  },
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
