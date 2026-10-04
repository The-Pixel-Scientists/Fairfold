// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the form engine says, in the words of docs/CONTENT-STYLE.md: what is
// wrong and how to fix it. Answer messages are for applicants; definition
// messages are for staff building a form. None repeats an answer.

import { formatMoney, type Money } from '../platform/money.ts';

/** The most questions one form may hold. */
export const MAX_FIELDS = 300;

function count(value: number): string {
  return value.toLocaleString('en-GB');
}

function options(value: number): string {
  return `${count(value)} option${value === 1 ? '' : 's'}`;
}

export const formMessages = {
  // Answers.
  notOnForm: 'Remove answers to questions that are not on this form.',
  notShown: 'This question no longer applies to you. Clear your answer to continue.',
  enterAnswer: 'Enter an answer to this question.',
  chooseAnswer: 'Choose an answer to this question.',
  chooseOption: 'Choose one of the options given.',
  chooseEachOnce: 'Choose each option only once.',
  chooseAtLeast: (min: number) => `Choose at least ${options(min)}.`,
  chooseAtMost: (max: number) => `Choose no more than ${options(max)}.`,
  yesOrNo: 'Choose yes or no.',
  oneLine: 'Enter this answer on one line.',
  tooManyWords: (max: number, used: number) =>
    `Enter ${count(max)} words or fewer. You have ${count(used)}.`,
  tooManyCharacters: (max: number, used: number) =>
    `Enter ${count(max)} characters or fewer. You have ${count(used)}.`,
  numberBetween: (min: number, max: number) =>
    `Enter a number from ${count(min)} to ${count(max)}.`,
  numberAtLeast: (min: number) => `Enter ${count(min)} or more.`,
  numberAtMost: (max: number) => `Enter ${count(max)} or less.`,
  amountBetween: (min: Money, max: Money) =>
    `Enter an amount from ${formatMoney(min)} to ${formatMoney(max)}.`,
  amountAtLeast: (min: Money) => `Enter an amount of ${formatMoney(min)} or more.`,
  realDate: 'Enter a real date, like 27 March 2027.',
  phone: 'Enter a phone number, like 01632 960 001 or +44 7700 900 982.',
  webAddress: 'Enter a web address that starts with https://, like https://www.example.org.',
  address: 'Enter the address in the boxes given, with no more than 100 characters in each.',
  addressLine1: 'Enter the first line of the address.',
  addressTown: 'Enter the town or city.',
  postcode: 'Enter a real postcode, like SW1A 1AA.',

  // Definitions.
  audiences: 'Choose who sees the answer: the applicant, and staff or reviewers or both.',
  idUsedTwice: 'Give this a different id. Each section and question needs its own.',
  conditionSource: 'Choose a question that comes before this one.',
  conditionType: 'Choose a choice or yes or no question to control when this one shows.',
  conditionValue: 'Choose an answer that question can have.',
  conditionReveals: 'Choose a question that everyone who sees this one can also see.',
  eligibilityRequired: 'Make eligibility questions required.',
  eligibilityStaff: 'Let staff see the answers to eligibility questions.',
  eligibilityValues: "Choose the answers that stop applicants from this question's options.",
  eligibilityAll: 'Leave at least one answer that lets applicants go on.',
  optionsUnique: 'Give each option a different value.',
  limitOrder: 'Make the lowest value no higher than the highest.',
  selectionsOptions: 'Allow no more selections than there are options.',
  tooManyFields: `Use no more than ${count(MAX_FIELDS)} questions in a form.`,
} as const;
