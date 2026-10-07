// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The three written sections of the Riverside Lunch Club application, as the
// form asks them: each question once, with the answers the applicant saved.
// The section screens fill them in, and check your answers reads them back.
// A question's id is the fragment that takes you to it, as in
// /application/organisation#organisation-name.

import type { ChoiceOption, FormAnswers, FormSectionDefinition } from '@pixel-scientists/ui';

import { applicant, application } from './story.ts';

/** One written section of the application, on a screen of its own. */
export interface FormScreen {
  title: string;
  path: string;
  /** Which section this is, counting from 1 in the task list. */
  number: number;
  /** Where "Save and continue" goes: the next section in the task list. */
  next: string;
  intro: string;
  /** The questions, in groups of a few that each get a heading. */
  groups: readonly FormSectionDefinition[];
}

/** Choices whose stored value is made from their words. */
const choices = (...labels: string[]): ChoiceOption[] =>
  labels.map((label) => ({
    value: label
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-')
      .replaceAll(/^-|-$/g, ''),
    label,
  }));

export const organisation: FormScreen = {
  title: 'About your organisation',
  path: '/application/organisation',
  number: 1,
  next: '/application/project',
  intro:
    "Tell us who you are and how to reach you. Have your charity number and last year's income to hand.",
  groups: [
    {
      id: 'your-organisation',
      title: 'Your organisation',
      fields: [
        {
          id: 'organisation-name',
          type: 'short_text',
          label: 'Organisation name',
          hint: 'Use the name in your governing document.',
          required: true,
        },
        {
          id: 'charity-registered',
          type: 'yes_no',
          label: 'Registered charity',
          hint: 'Choose Yes if the Charity Commission has registered you.',
          required: true,
        },
        {
          id: 'charity-number',
          type: 'short_text',
          label: 'Registered charity number',
          hint: "You can find it on the Charity Commission's register of charities.",
          required: true,
        },
        {
          id: 'governing-document',
          type: 'single_choice',
          label: 'Governing document',
          required: true,
          options: choices('Constitution', 'Trust deed', 'Articles of association', 'Rules'),
        },
        {
          id: 'address',
          type: 'uk_address',
          label: 'Address',
          hint: 'Where your organisation is based.',
          required: true,
        },
      ],
    },
    {
      id: 'main-contact',
      title: 'Main contact',
      introduction: 'This is the person we write to about your application.',
      fields: [
        { id: 'contact-name', type: 'short_text', label: 'Main contact name', required: true },
        { id: 'contact-email', type: 'email', label: 'Main contact email', required: true },
        { id: 'contact-phone', type: 'phone', label: 'Main contact phone', required: true },
      ],
    },
    {
      id: 'size-and-leadership',
      title: 'Size and leadership',
      fields: [
        {
          id: 'income',
          type: 'currency',
          currency: 'GBP',
          label: 'Income last year',
          hint: 'All the money your organisation received in your last financial year.',
          required: true,
        },
        {
          id: 'people',
          type: 'number',
          wholeNumber: true,
          label: 'Paid staff and regular volunteers',
          hint: 'Count everyone who helps every month.',
          required: true,
        },
        {
          id: 'led-by',
          type: 'multiple_choice',
          label: 'Who leads your organisation?',
          hint: 'We ask so that we can check we fund fairly. We only share totals.',
          required: false,
          options: choices(
            'Led by women',
            'Led by and for disabled people',
            'Led by and for Black and minoritised communities',
            'Led by and for LGBTQ+ people',
            'None of these',
            'Prefer not to say',
          ),
        },
      ],
    },
  ],
};

export const project: FormScreen = {
  title: 'Your project',
  path: '/application/project',
  number: 2,
  next: '/application/budget',
  intro: 'Tell us what you will do, where and when, and who it will help.',
  groups: [
    {
      id: 'about-the-project',
      title: 'About your project',
      fields: [
        { id: 'project-name', type: 'short_text', label: 'Project name', required: true },
        {
          id: 'project-summary',
          type: 'long_text',
          label: 'Project summary',
          hint: 'Say what you will do and who it is for, in a sentence or two.',
          required: true,
          maxWords: 50,
        },
        {
          id: 'need',
          type: 'long_text',
          label: 'Why it is needed',
          hint: 'Tell us about the need, and how you know it is real.',
          required: true,
          maxWords: 250,
        },
        {
          id: 'activities',
          type: 'long_text',
          label: 'What you will do',
          hint: 'Say what will happen, how often, and who will run it.',
          required: true,
          maxWords: 300,
        },
      ],
    },
    {
      id: 'when-and-where',
      title: 'When and where',
      fields: [
        { id: 'start-date', type: 'date', label: 'Start date', required: true },
        { id: 'end-date', type: 'date', label: 'End date', required: true },
        { id: 'venue', type: 'short_text', label: 'Where it will take place', required: true },
      ],
    },
    {
      id: 'who-it-is-for',
      title: 'Who it is for',
      fields: [
        {
          id: 'areas',
          type: 'multiple_choice',
          label: 'Which areas will it serve?',
          required: true,
          options: choices(
            'Northfield Central',
            'Eastbrook',
            'Hartley Green',
            'Millbrook',
            'Sandford',
            'Westfield',
            'Oakmere',
          ),
        },
        {
          id: 'beneficiaries',
          type: 'multiple_choice',
          label: 'Who will benefit most from your project?',
          hint: 'We only share totals.',
          required: false,
          options: choices(
            'People on low incomes',
            'Children and young people',
            'Older people',
            'Disabled people',
            'Carers',
            'Refugees and migrants',
          ),
        },
      ],
    },
  ],
};

export const outcomes: FormScreen = {
  title: 'Outcomes',
  path: '/application/outcomes',
  number: 4,
  next: '/application/documents',
  intro: 'Tell us what will change for people, and how you will know. This takes about 10 minutes.',
  groups: [
    {
      id: 'the-difference',
      title: 'The difference you will make',
      fields: [
        {
          id: 'change',
          type: 'long_text',
          label: 'What will change',
          hint: 'Say what will be different for people because of your project.',
          required: true,
          maxWords: 200,
        },
        {
          id: 'participants',
          type: 'number',
          wholeNumber: true,
          label: 'How many people will take part?',
          hint: 'Your best guess at how many different people will come.',
          required: true,
        },
      ],
    },
    {
      id: 'shaping-and-measuring',
      title: 'Who shapes it, and how you will know',
      fields: [
        {
          id: 'involvement',
          type: 'long_text',
          label: 'How will the people taking part help to shape it?',
          hint: 'For example, a survey, a planning group or a feedback session.',
          required: true,
          maxWords: 150,
        },
        {
          id: 'evidence',
          type: 'long_text',
          label: 'How you will know',
          hint: 'Say what you will count or ask, and when.',
          required: true,
          maxWords: 150,
        },
      ],
    },
  ],
};

const [line1, line2, town, postcode] = applicant.address.split(', ');

/** What the applicant has saved, keyed by question id. */
export const answers: FormAnswers = {
  'organisation-name': applicant.organisation,
  'charity-registered': true,
  'charity-number': applicant.charityNumber,
  address: { line1, line2, town, postcode },
  'contact-name': applicant.name,
  'contact-email': applicant.email,
  'contact-phone': applicant.phone,
  income: { amountMinor: 18_420_000, currency: 'GBP' },
  people: 44,
  'led-by': ['led-by-women'],
  'project-name': application.project,
  'project-summary':
    'A hot three-course lunch every Tuesday at Riverside Hall for people aged 65 and over who live alone.',
  need: 'Northfield Central has more older people living alone than anywhere else in the county. In our 2026 survey of 112 residents aged 65 and over, 6 in 10 said they eat their main meal alone most days, and 4 in 10 had not left home on at least three days that week. Our Tuesday coffee morning is always full, and 23 people are waiting for a lunch place that does not exist yet.',
  activities:
    'From 1 June 2027 we will serve a hot three-course lunch for up to 40 people every Tuesday for 48 weeks. A paid cook leads a rota of eight trained volunteers. A minibus brings 12 people who cannot get to the hall. After lunch there is something optional to join: a quiz, gentle exercise, or a visit from an adviser on benefits and health services.',
  'start-date': '2027-06-01',
  'end-date': '2028-04-25',
  venue: 'Riverside Hall, Mill Lane, Northfield',
  areas: ['northfield-central'],
  beneficiaries: ['older-people', 'disabled-people'],
  change:
    'People will eat a hot meal with company at least once a week, make friends, and hear about benefits and health services they may be missing. We expect most regular guests to tell us they feel less lonely after six months.',
  participants: 120,
  involvement:
    'Guests chose the format in our 2026 survey, and four of them will join a planning group that meets once a month to choose the menus and activities.',
  evidence:
    'We will ask guests to complete a short loneliness scale when they join and again after six months, and keep a register of who comes. We will report numbers, the change in scores and three guest stories at the end of the grant.',
};

/** "Registered charity" decides which of the next two questions is asked. */
export function isShown(id: string, given: FormAnswers): boolean {
  if (id === 'charity-number') return given['charity-registered'] === true;
  if (id === 'governing-document') return given['charity-registered'] === false;
  return true;
}
