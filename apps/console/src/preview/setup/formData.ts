// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Spring 2027 application form, version 3: the six sections of the
// portal's story with their questions, in the shape the builder edits.

import { featuredBudget, pounds } from '../story.ts';

export type QuestionType =
  | 'short_text'
  | 'long_text'
  | 'number'
  | 'currency'
  | 'date'
  | 'email'
  | 'yes_no'
  | 'choice'
  | 'budget_table'
  | 'file_upload'
  | 'confirmation';

export const questionTypes: readonly { value: QuestionType; label: string }[] = [
  { value: 'short_text', label: 'Short text' },
  { value: 'long_text', label: 'Long text' },
  { value: 'number', label: 'Number' },
  { value: 'currency', label: 'Currency' },
  { value: 'date', label: 'Date' },
  { value: 'email', label: 'Email address' },
  { value: 'yes_no', label: 'Yes or no' },
  { value: 'choice', label: 'Choice' },
  { value: 'budget_table', label: 'Budget table' },
  { value: 'file_upload', label: 'File upload' },
  { value: 'confirmation', label: 'Confirmation' },
];

/** Who sees the answer. Blind review hides identifying answers from reviewers. */
export type Visibility = 'everyone' | 'staff' | 'totals';

export const visibilities: readonly { value: Visibility; label: string }[] = [
  { value: 'everyone', label: 'Staff and reviewers' },
  { value: 'staff', label: 'Staff only, hidden from reviewers' },
  { value: 'totals', label: 'Totals only, for equality monitoring' },
];

export type Condition = 'always' | 'charity-yes' | 'charity-no';

export const conditions: readonly { value: Condition; label: string; note: string }[] = [
  { value: 'always', label: 'Always', note: '' },
  {
    value: 'charity-yes',
    label: 'When ‘Registered charity’ is Yes',
    note: 'Shown when ‘Registered charity’ is Yes',
  },
  {
    value: 'charity-no',
    label: 'When ‘Registered charity’ is No',
    note: 'Shown when ‘Registered charity’ is No',
  },
];

export interface BudgetColumn {
  heading: string;
  kind: 'text' | 'currency';
}

/** The ids of the budget tables a worked-out amount is made from: the first's total, less the second's. */
export interface WorkedOut {
  total: string;
  less: string;
}

export interface FormQuestion {
  id: string;
  label: string;
  hint: string;
  type: QuestionType;
  required: boolean;
  visibility: Visibility;
  condition: Condition;
  /** Long text. */
  wordLimit: number;
  /** Currency, in pounds. */
  minAmount: number;
  maxAmount: number;
  /** Currency the applicant is shown, not asked for. */
  workedOut: WorkedOut | null;
  /** Choice: one option to a line. */
  options: string;
  multiple: boolean;
  /** Budget table. `sample` is what the preview fills in, a row of text for each. */
  columns: readonly BudgetColumn[];
  sample: readonly (readonly string[])[];
  minRows: number;
  maxRows: number;
  showTotal: boolean;
  /** The words on the total row and on the button that adds a row. */
  totalLabel: string;
  addLabel: string;
  /** File upload. */
  accept: readonly string[];
  maxSizeMb: number;
  maxFiles: number;
}

export interface FormSection {
  id: string;
  title: string;
  introduction: string;
  questions: readonly FormQuestion[];
}

const defaults = {
  hint: '',
  required: true,
  visibility: 'everyone',
  condition: 'always',
  wordLimit: 300,
  minAmount: 0,
  maxAmount: 0,
  workedOut: null,
  options: '',
  multiple: false,
  columns: [],
  sample: [],
  minRows: 1,
  maxRows: 10,
  showTotal: false,
  totalLabel: 'Total',
  addLabel: 'Add a row',
  accept: [],
  maxSizeMb: 10,
  maxFiles: 1,
} as const satisfies Partial<FormQuestion>;

function question(
  id: string,
  label: string,
  type: QuestionType,
  rest: Partial<FormQuestion> = {},
): FormQuestion {
  return { ...defaults, id, label, type, ...rest };
}

export const fileTypes = ['PDF', 'Word', 'Excel', 'Image'] as const;

export const areas = [
  'Northfield Central',
  'Eastbrook',
  'Hartley Green',
  'Millbrook',
  'Sandford',
  'Westfield',
  'Oakmere',
];

export const formVersion = { number: 3, published: '1 February 2027' };

export const formSections: readonly FormSection[] = [
  {
    id: 'organisation',
    title: 'About your organisation',
    introduction: 'Tell us who you are. Reviewers do not see your name or contact details.',
    questions: [
      question('org-name', 'Organisation name', 'short_text', {
        hint: 'Use the name on your governing document.',
        visibility: 'staff',
      }),
      question('charity-registered', 'Registered charity', 'yes_no', {
        hint: 'Choose Yes if you are on the Charity Commission register.',
      }),
      question('charity-number', 'Registered charity number', 'short_text', {
        hint: 'Charity numbers have 6 to 8 digits.',
        condition: 'charity-yes',
        visibility: 'staff',
      }),
      question('governing-document', 'Governing document', 'choice', {
        hint: 'Choose the document that sets out how your group is run.',
        condition: 'charity-no',
        options: 'Constitution\nTrust deed\nArticles of association\nRules',
      }),
      question('address', 'Address', 'long_text', {
        hint: 'Include the postcode.',
        wordLimit: 50,
        visibility: 'staff',
      }),
      question('contact-name', 'Main contact name', 'short_text', { visibility: 'staff' }),
      question('contact-email', 'Main contact email', 'email', { visibility: 'staff' }),
      question('contact-phone', 'Main contact phone', 'short_text', { visibility: 'staff' }),
      question('income', 'Income last year', 'currency', {
        hint: 'Total income in pounds, from your latest accounts.',
      }),
      question('people', 'Paid staff and regular volunteers', 'number', {
        hint: 'Count the people who work or volunteer for you most weeks.',
      }),
      question('led-by', 'Who leads your organisation?', 'choice', {
        hint: 'Choose any that apply. Only totals are reported.',
        required: false,
        visibility: 'totals',
        multiple: true,
        options:
          'Led by women\nLed by and for disabled people\nLed by and for Black and minoritised communities\nLed by and for LGBTQ+ people\nNone of these\nPrefer not to say',
      }),
    ],
  },
  {
    id: 'project',
    title: 'Your project',
    introduction: 'Describe what you will do, who it is for and where.',
    questions: [
      question('project-name', 'Project name', 'short_text', {
        hint: 'A short name that reviewers will recognise.',
      }),
      question('project-summary', 'Project summary', 'long_text', {
        hint: 'In a few sentences, what is the project and who is it for?',
        wordLimit: 50,
      }),
      question('need', 'Why it is needed', 'long_text', {
        hint: 'Say who needs it, how you know, and why now.',
        wordLimit: 250,
      }),
      question('activities', 'What you will do', 'long_text', {
        hint: 'Say what will happen, how often, and who will run it.',
        wordLimit: 300,
      }),
      question('start-date', 'Start date', 'date', { hint: 'For example, 1 June 2027.' }),
      question('end-date', 'End date', 'date', { hint: 'No more than 12 months after it starts.' }),
      question('venue', 'Where it will take place', 'short_text', {
        hint: 'Name the building or place.',
      }),
      question('areas', 'Which areas will it serve?', 'choice', {
        hint: 'Choose every area it serves.',
        multiple: true,
        options: areas.join('\n'),
      }),
      question('beneficiaries', 'Who will benefit most from your project?', 'choice', {
        hint: 'Choose any that apply. Only totals are reported.',
        required: false,
        visibility: 'totals',
        multiple: true,
        options:
          'People on low incomes\nChildren and young people\nOlder people\nDisabled people\nCarers\nRefugees and migrants',
      }),
    ],
  },
  {
    id: 'budget',
    title: 'Budget',
    introduction: 'List what the project costs and any other money already promised.',
    questions: [
      question('budget', 'Costs of the project', 'budget_table', {
        hint: 'Add a line for each cost. Say what it is, and how you worked out the amount. For example: “48 Tuesdays at £60”.',
        columns: [
          { heading: 'Item', kind: 'text' },
          { heading: 'Detail', kind: 'text' },
          { heading: 'Cost', kind: 'currency' },
        ],
        sample: featuredBudget.map((row) => [row.item, row.detail, pounds(row.cost)]),
        minRows: 1,
        maxRows: 12,
        showTotal: true,
        totalLabel: 'Total cost of the project',
        addLabel: 'Add a cost',
      }),
      question('other-funding', 'Other funding', 'budget_table', {
        hint: 'Is any other money going into this project? Tell us who is giving it and how much. We take it off what you ask us for.',
        required: false,
        columns: [
          { heading: 'Where the money comes from', kind: 'text' },
          { heading: 'Amount', kind: 'currency' },
        ],
        sample: [['Northfield Parish Council', '£1,000']],
        minRows: 0,
        maxRows: 6,
        showTotal: true,
        totalLabel: 'Total other funding',
        addLabel: 'Add other funding',
      }),
      question('funding-evidence', 'Evidence of other funding', 'file_upload', {
        hint: 'A letter or email from each funder that confirms the money.',
        required: false,
        visibility: 'staff',
        accept: ['PDF', 'Word'],
      }),
      question('requested', 'Amount you are asking for', 'currency', {
        hint: 'We work this out for you: the total cost of the project, less other funding.',
        minAmount: 1_000,
        maxAmount: 25_000,
        workedOut: { total: 'budget', less: 'other-funding' },
      }),
    ],
  },
  {
    id: 'outcomes',
    title: 'Outcomes',
    introduction: 'Tell us what will be different, and how you will know.',
    questions: [
      question('change', 'What will change', 'long_text', {
        wordLimit: 200,
      }),
      question('participants', 'How many people will take part?', 'number'),
      question('involvement', 'How will the people taking part help to shape it?', 'long_text', {
        hint: 'For example, a survey, a planning group or a panel of users.',
        wordLimit: 150,
      }),
      question('evidence', 'How you will know', 'long_text', { wordLimit: 150 }),
    ],
  },
  {
    id: 'documents',
    title: 'Documents',
    introduction: 'Upload the documents we need to check your group.',
    questions: [
      question('accounts', 'Your latest accounts', 'file_upload', {
        hint: 'Or a record of the money you have received and spent, if your group is new.',
        visibility: 'staff',
        accept: ['PDF', 'Word'],
      }),
      question('constitution', 'Your constitution', 'file_upload', {
        hint: 'The rules your group runs by. It may be called a governing document.',
        visibility: 'staff',
        accept: ['PDF', 'Word'],
      }),
      question('safeguarding', 'Your safeguarding policy', 'file_upload', {
        hint: 'How you keep children and adults at risk safe.',
        visibility: 'staff',
        accept: ['PDF', 'Word'],
      }),
    ],
  },
  {
    id: 'declarations',
    title: 'Declarations',
    introduction: 'Confirm that what you have told us is true.',
    questions: [
      question(
        'declaration-agreed',
        'Our governing body has agreed to this application.',
        'confirmation',
      ),
      question(
        'declaration-safeguarding',
        'Our safeguarding policy was reviewed in the last 12 months.',
        'confirmation',
      ),
      question(
        'declaration-correct',
        'The answers in this application are true, and I am allowed to apply for my organisation.',
        'confirmation',
      ),
    ],
  },
];

/** A typed amount such as “£2,880” in pounds. Text that is not an amount counts as nothing. */
export const amountOf = (text: string): number =>
  Number.parseFloat(text.replace(/[£,\s]/g, '')) || 0;

/** The cost column of a budget table, added up. */
export function budgetTotal(question: FormQuestion, rows: readonly (readonly string[])[]): number {
  const cost = question.columns.findIndex((column) => column.kind === 'currency');
  return rows.reduce((sum, row) => sum + amountOf(row[cost] ?? ''), 0);
}

/** What each budget table adds up to, by question id. */
export type Totals = Readonly<Record<string, number>>;

/** Each budget table's total as the form first shows it, from the example rows. */
export const sampleTotals: Totals = Object.fromEntries(
  formSections
    .flatMap((section) => section.questions)
    .filter((item) => item.type === 'budget_table')
    .map((item) => [item.id, budgetTotal(item, item.sample)]),
);

/** The amount a worked-out question shows: one total less the other, never below nothing. */
export const workedOutAmount = ({ total, less }: WorkedOut, totals: Totals): number =>
  Math.max((totals[total] ?? 0) - (totals[less] ?? 0), 0);

export const blankQuestion = (id: string): FormQuestion =>
  question(id, 'Untitled question', 'short_text');

export function typeLabel(question: FormQuestion): string {
  const label = questionTypes.find((type) => type.value === question.type)?.label ?? '';
  if (question.type === 'long_text') return `${label}, ${String(question.wordLimit)} words`;
  return label;
}

/** A question added in this session, which no published version has. */
export const isNew = (id: string): boolean => id.startsWith('new-');
