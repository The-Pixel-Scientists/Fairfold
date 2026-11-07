// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The equality monitoring question set (ADR 0032). Every question is about
// the person answering, is optional, is a choice from a fixed list with
// "Prefer not to say", is seen only in totals and is special category. A
// funder chooses which questions a round's form uses and in what order, and
// cannot add one or change one's wording or options: a new question is added
// here, under a new field id, after review against ADR 0032. The ids are
// stable, since answers are keyed by them (rule 7).

import type { FormDefinition, Question } from '@pixel-scientists/domain/forms';

/** The option every monitoring choice question has. */
export const preferNotToSay = { value: 'prefer_not_to_say', label: 'Prefer not to say' } as const;

type Choice = readonly [value: string, label: string];

function question(id: string, label: string, choices: readonly Choice[], hint?: string): Question {
  return {
    id,
    type: 'single_choice',
    label,
    ...(hint === undefined ? {} : { hint }),
    required: false,
    identity: false,
    audiences: 'aggregate_only',
    classification: 'special_category',
    conditions: [],
    options: [...choices.map(([value, text]) => ({ value, label: text })), { ...preferNotToSay }],
  };
}

const yesNo: readonly Choice[] = [
  ['yes', 'Yes'],
  ['no', 'No'],
];

const questions = [
  question('f_agegroup', 'What is your age?', [
    ['under_25', 'Under 25'],
    ['25_34', '25 to 34'],
    ['35_44', '35 to 44'],
    ['45_54', '45 to 54'],
    ['55_64', '55 to 64'],
    ['65_over', '65 or over'],
  ]),
  question(
    'f_disability',
    'Do you consider yourself to be disabled?',
    yesNo,
    'The Equality Act 2010 says you are disabled if you have a physical or mental condition that has a substantial and long-term effect on your ability to do normal daily activities.',
  ),
  question('f_ethnicgroup', 'What is your ethnic group?', [
    ['asian', 'Asian or Asian British'],
    ['black', 'Black, Black British, Caribbean or African'],
    ['mixed', 'Mixed or multiple ethnic groups'],
    ['white', 'White'],
    ['other', 'Another ethnic group'],
  ]),
  question('f_religion', 'What is your religion or belief?', [
    ['none', 'No religion'],
    ['buddhist', 'Buddhist'],
    ['christian', 'Christian'],
    ['hindu', 'Hindu'],
    ['jewish', 'Jewish'],
    ['muslim', 'Muslim'],
    ['sikh', 'Sikh'],
    ['other', 'Another religion or belief'],
  ]),
  question('f_sex', 'What is your sex?', [
    ['female', 'Female'],
    ['male', 'Male'],
  ]),
  question(
    'f_genderidentity',
    'Is the gender you identify with the same as your sex registered at birth?',
    yesNo,
  ),
  question('f_sexualorientation', 'Which of these best describes your sexual orientation?', [
    ['straight', 'Straight or heterosexual'],
    ['gay_lesbian', 'Gay or lesbian'],
    ['bisexual', 'Bisexual'],
    ['other', 'Another sexual orientation'],
  ]),
];

/** The set, by field id, in the order the starting template asks them. */
export const monitoringQuestions: ReadonlyMap<string, Question> = new Map(
  questions.map((field) => [field.id, field]),
);

/** A new monitoring form with every question in the set, for a funder to trim and reorder. */
export function monitoringTemplate(): FormDefinition {
  return {
    sections: [
      {
        id: 's_monitoring',
        title: 'Equality monitoring',
        conditions: [],
        fields: structuredClone(questions),
      },
    ],
  };
}
