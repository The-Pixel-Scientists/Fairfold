// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The builder's words for question types and for who sees an answer, as
// docs/CONTENT-STYLE.md writes them.

import type { FormField, Question } from '@pixel-scientists/domain/forms';

import type { EditableType } from './draft.ts';

/** The types a manager can choose, with what an applicant does for each. */
export const questionTypes = [
  { value: 'short_text', label: 'Short text', note: 'Applicants type a short answer on one line.' },
  { value: 'long_text', label: 'Long text', note: 'Applicants type as much as the limits allow.' },
  { value: 'number', label: 'Number', note: 'Applicants enter a number.' },
  { value: 'currency', label: 'Amount in pounds', note: 'Applicants enter an amount in pounds.' },
  { value: 'date', label: 'Date', note: 'Applicants enter a day, month and year.' },
  {
    value: 'email',
    label: 'Email address',
    note: 'Applicants enter an email address, which is checked for its format.',
  },
  {
    value: 'phone',
    label: 'Phone number',
    note: 'Applicants enter a phone number, which is checked for its format.',
  },
  {
    value: 'url',
    label: 'Web address',
    note: 'Applicants enter a web address that starts with https://.',
  },
  { value: 'single_choice', label: 'Choose one', note: 'Applicants choose one of the choices.' },
  {
    value: 'dropdown',
    label: 'Choose one from a list',
    note: 'Applicants choose one of the choices from a list.',
  },
  {
    value: 'multiple_choice',
    label: 'Choose several',
    note: 'Applicants tick every choice that applies.',
  },
  {
    value: 'yes_no',
    label: 'Yes or no',
    note: 'Applicants choose Yes or No. Later questions can depend on the answer.',
  },
  {
    value: 'uk_address',
    label: 'UK address',
    note: 'Applicants enter an address in separate boxes, with a postcode that is checked.',
  },
] as const satisfies readonly { value: EditableType; label: string; note: string }[];

/** What the outline calls a type, including those the builder cannot edit yet. */
export function typeLabel(type: FormField['type']): string {
  const found = questionTypes.find((item) => item.value === type);
  if (found !== undefined) return found.label;
  return type === 'content'
    ? 'Text for applicants to read'
    : type === 'table'
      ? 'Table'
      : 'File upload';
}

interface Viewing {
  value: string;
  label: string;
  audiences: Question['audiences'];
  hint: string;
}

const everyone: Viewing = {
  value: 'everyone',
  label: 'Staff and reviewers',
  audiences: ['applicant', 'staff', 'reviewer'],
  hint: 'Everyone who works on the application sees the answer.',
};

/** Who sees an answer once the application is in. The applicant always sees their own. */
export const viewings: readonly Viewing[] = [
  everyone,
  {
    value: 'staff',
    label: 'Staff only, not reviewers',
    audiences: ['applicant', 'staff'],
    hint: 'Reviewers never see the answer. Use this for contact details.',
  },
  {
    value: 'reviewers',
    label: 'Reviewers only, not staff',
    audiences: ['applicant', 'reviewer'],
    hint: 'Staff do not see the answer on the application.',
  },
  {
    value: 'applicant',
    label: 'The applicant only',
    audiences: ['applicant'],
    hint: 'Neither staff nor reviewers see the answer.',
  },
  {
    value: 'totals',
    label: 'Only in totals',
    audiences: 'aggregate_only',
    hint: 'Staff and reviewers never see the answer. It counts only in reports, such as equality monitoring.',
  },
];

/** The choice that matches a question's audiences, whatever order they are in. */
export function viewingOf(audiences: Question['audiences']): Viewing {
  const same = (other: Question['audiences']) =>
    typeof audiences === 'string' || typeof other === 'string'
      ? audiences === other
      : audiences.length === other.length && audiences.every((who) => other.includes(who));
  return viewings.find((viewing) => same(viewing.audiences)) ?? everyone;
}
