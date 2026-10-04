// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Whether an applicant may go on. Only shown eligibility questions count.
// The first one whose answer stops the applicant decides; otherwise the
// applicant is incomplete while any is unanswered, and eligible after.

import type { FormDefinition } from './rules.ts';
import { visibleFields, type Answers } from './visibility.ts';

export type EligibilityResult =
  | { status: 'eligible' }
  | { status: 'stopped'; fieldId: string; explanation: string }
  | { status: 'incomplete' };

export function checkEligibility(definition: FormDefinition, answers: Answers): EligibilityResult {
  let incomplete = false;
  for (const field of visibleFields(definition, answers)) {
    if (field.type !== 'single_choice' && field.type !== 'yes_no') continue;
    if (field.eligibility === undefined) continue;
    const value = Object.hasOwn(answers, field.id) ? answers[field.id] : undefined;
    const { eligibility } = field;
    const stops =
      'stopWhen' in eligibility
        ? value === eligibility.stopWhen
        : typeof value === 'string' && eligibility.stopValues.includes(value);
    if (stops) {
      return { status: 'stopped', fieldId: field.id, explanation: eligibility.explanation };
    }
    const answered =
      field.type === 'yes_no'
        ? typeof value === 'boolean'
        : field.options.some((option) => option.value === value);
    if (!answered) incomplete = true;
  }
  return incomplete ? { status: 'incomplete' } : { status: 'eligible' };
}
