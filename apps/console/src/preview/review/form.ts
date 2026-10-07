// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The questions of the Spring 2027 form, version 3, as the review previews
// show their answers: the same ids and labels the form builder edits. Each
// audience gets only the questions it may see, so a reviewer's definitions
// never hold a staff-only question, and answers keyed by those ids fill them.

import type {
  FormAnswers,
  FormFieldDefinition,
  FormSectionDefinition,
  VisibleFields,
} from '@pixel-scientists/ui';

import { formSections, formVersion } from '../setup/formData.ts';
import type { FormQuestion } from '../setup/formData.ts';

export { formVersion };

export type Audience = 'staff' | 'reviewer';

/** A question the answer view can show. Budget tables and files have screens of their own. */
function fieldOf(question: FormQuestion): FormFieldDefinition | null {
  const field = {
    id: question.id,
    label: question.label,
    hint: question.hint === '' ? undefined : question.hint,
    required: question.required,
  };
  switch (question.type) {
    case 'short_text':
      return { ...field, type: 'short_text' };
    case 'long_text':
      return { ...field, type: 'long_text', maxWords: question.wordLimit };
    case 'number':
      return { ...field, type: 'number', wholeNumber: true };
    case 'currency':
      return { ...field, type: 'currency', currency: 'GBP' };
    case 'date':
    case 'email':
    case 'yes_no':
      return { ...field, type: question.type };
    case 'confirmation':
      return { ...field, type: 'yes_no' };
    case 'choice': {
      const options = question.options.split('\n').map((label) => ({ value: label, label }));
      return { ...field, type: question.multiple ? 'multiple_choice' : 'single_choice', options };
    }
    case 'budget_table':
    case 'file_upload':
      return null;
  }
}

function mayShow(question: FormQuestion, audience: Audience, answers: FormAnswers): boolean {
  const registered = answers['charity-registered'];
  return (
    (question.visibility === 'everyone' ||
      (question.visibility === 'staff' && audience === 'staff')) &&
    (question.condition === 'always' ||
      (question.condition === 'charity-yes' ? registered === true : registered === false))
  );
}

/**
 * The sections of answers an audience reads, from the questions it may see
 * for these answers. Equality questions, which only ever give totals, are in
 * no audience's list. The budget and the documents are shown by their own parts.
 */
export function answerSections(
  audience: Audience,
  answers: FormAnswers,
): { sections: readonly FormSectionDefinition[]; visible: VisibleFields } {
  const sections = formSections
    .filter((section) => section.questions.every((question) => fieldOf(question) !== null))
    .map((section) => ({
      id: section.id,
      title: section.title,
      fields: section.questions
        .filter((question) => mayShow(question, audience, answers))
        .flatMap((question) => fieldOf(question) ?? []),
    }));
  return { sections, visible: sections.flatMap((section) => section.fields) };
}
