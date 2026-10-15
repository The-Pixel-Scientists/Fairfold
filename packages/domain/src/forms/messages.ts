// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the form engine says, in the words of docs/CONTENT-STYLE.md: what is
// wrong and how to fix it. Answer messages are for applicants; definition
// messages are for staff building a form. None repeats an answer.

import { fileTypeLabels, type FileType } from '../files/types.ts';
import { formatMoney, type Money } from '../platform/money.ts';

/** The most questions one form may hold. */
export const MAX_FIELDS = 300;

function count(value: number): string {
  return value.toLocaleString('en-GB');
}

function options(value: number): string {
  return `${count(value)} option${value === 1 ? '' : 's'}`;
}

/** A number of table rows, with the table's noun for one row: "1 cost", "3 activities". */
function rows(value: number, noun: string): string {
  if (value === 1) return `1 ${noun}`;
  if (/(?:s|x|z|ch|sh)$/i.test(noun)) return `${count(value)} ${noun}es`;
  if (/[^aeiou]y$/i.test(noun)) return `${count(value)} ${noun.slice(0, -1)}ies`;
  return `${count(value)} ${noun}s`;
}

function files(value: number): string {
  return `${count(value)} file${value === 1 ? '' : 's'}`;
}

/** File types in words, the first with its article: "a PDF or Word document". */
function fileTypesInWords(types: readonly FileType[]): string {
  const words = types.map((type) => fileTypeLabels[type]);
  const last = words.pop();
  const list = words.length === 0 ? `${last}` : `${words.join(', ')} or ${last}`;
  return `${/^[aeiou]/i.test(list) ? 'an' : 'a'} ${list}`;
}

/** A size limit in MB (MiB), or KB below 1 MB, rounded down to a tenth so it never overstates. */
function size(bytes: number): string {
  const [unit, per] = bytes >= 1024 * 1024 ? ['MB', 1024 * 1024] : ['KB', 1024];
  return `${(Math.floor((bytes * 10) / per) / 10).toLocaleString('en-GB')} ${unit}`;
}

/**
 * What the engine says about one cell of a table, naming its row as the
 * table's noun and number, such as "cost 2". The checks match the question
 * of the same type, so validate.ts pairs these with the question messages.
 */
function cellMessages(row: string) {
  return {
    enterText: `Enter text for ${row}.`,
    oneLine: `Enter the answer for ${row} on one line.`,
    tooManyCharacters: (max: number, used: number) =>
      `Enter ${count(max)} characters or fewer for ${row}. You have ${count(used)}.`,
    enterNumber: `Enter a number for ${row}.`,
    enterWholeNumber: `Enter a whole number for ${row}.`,
    numberBetween: (min: number, max: number) =>
      `Enter a number from ${count(min)} to ${count(max)} for ${row}.`,
    numberAtLeast: (min: number) => `Enter ${count(min)} or more for ${row}.`,
    numberAtMost: (max: number) => `Enter ${count(max)} or less for ${row}.`,
    amountInPounds: `Enter the amount for ${row} in pounds.`,
    amountBetween: (min: Money, max: Money) =>
      `Enter an amount from ${formatMoney(min)} to ${formatMoney(max)} for ${row}.`,
    amountAtLeast: (min: Money) => `Enter an amount of ${formatMoney(min)} or more for ${row}.`,
    chooseOption: `Choose one of the options given for ${row}.`,
  };
}

export type AnswerWords = ReturnType<typeof cellMessages>;

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
  tableRows: 'Send the answers to this table as a list of rows.',
  notInTable: 'Remove answers to columns that are not in this table.',
  rowsAtLeast: (min: number, noun: string) => `Add at least ${rows(min, noun)}.`,
  rowsAtMost: (max: number, noun: string) => `Add no more than ${rows(max, noun)}.`,
  emptyRow: (row: string) => `Fill in ${row} or remove it.`,
  enterCell: (row: string) => `Enter an answer for ${row}.`,
  enterCellNumber: (row: string) => `Enter a number for ${row}.`,
  enterCellAmount: (row: string) => `Enter an amount for ${row}.`,
  chooseCell: (row: string) => `Choose an answer for ${row}.`,
  cell: cellMessages,
  uploadFile: 'Upload a file for this question.',
  fileIds: 'Send the files for this question as a list of file ids.',
  uploadEachOnce: 'Upload each file only once.',
  uploadAtMost: (max: number) => `Upload no more than ${files(max)}.`,
  fileType: (types: readonly FileType[]) => `The file must be ${fileTypesInWords(types)}.`,
  fileSize: (maxBytes: number) => `The file must be ${size(maxBytes)} or smaller.`,

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
  columnIdUsedTwice: 'Give this column a different id. Each column in a table needs its own.',
  totalType: 'Turn off the total. Only number and currency columns can have one.',
  fileTypesUnique: 'Choose each file type only once.',
  fileAudiences: 'Choose who sees the files: the applicant, and staff or reviewers or both.',
  tooManyFields: `Use no more than ${count(MAX_FIELDS)} questions in a form.`,
} as const;
