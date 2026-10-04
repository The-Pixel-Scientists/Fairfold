// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Test data for the form engine's tests: a small form with one field of
// every type, conditions, eligibility, identity and aggregate-only fields.
// Synthetic only.

import { formDefinitionSchema } from './rules.ts';

export const exampleInput = {
  sections: [
    {
      id: 's_about',
      title: 'About your organisation',
      fields: [
        {
          id: 'f_charity',
          type: 'yes_no',
          label: 'Is your organisation a registered charity?',
          required: true,
          eligibility: {
            stopWhen: false,
            explanation: 'This fund is open to registered charities only.',
          },
        },
        {
          id: 'f_orgname',
          type: 'short_text',
          label: 'Organisation name',
          required: true,
          identity: true,
          maxCharacters: 120,
        },
        {
          id: 'f_email',
          type: 'email',
          label: 'Contact email address',
          required: true,
          identity: true,
          audiences: ['applicant', 'staff'],
        },
        { id: 'f_phone', type: 'phone', label: 'Contact phone number', identity: true },
        { id: 'f_address', type: 'uk_address', label: 'Registered address', identity: true },
        { id: 'f_site', type: 'url', label: 'Website' },
      ],
    },
    {
      id: 's_project',
      title: 'Your project',
      fields: [
        {
          id: 'f_kind',
          type: 'single_choice',
          label: 'What will the money pay for?',
          required: true,
          options: [
            { value: 'building', label: 'Building work' },
            { value: 'equipment', label: 'Equipment' },
            { value: 'loans', label: 'Paying off loans' },
          ],
          eligibility: {
            stopValues: ['loans'],
            explanation: 'We cannot pay off loans or other debts.',
          },
        },
        {
          id: 'f_works',
          type: 'long_text',
          label: 'Describe the building work',
          required: true,
          maxWords: 250,
          conditions: [{ field: 'f_kind', equals: 'building' }],
        },
        {
          id: 'f_amount',
          type: 'currency',
          label: 'How much do you need?',
          required: true,
          minMinor: 500_000,
          maxMinor: 2_500_000,
        },
        { id: 'f_start', type: 'date', label: 'When will the project start?' },
        {
          id: 'f_people',
          type: 'number',
          label: 'How many people will benefit?',
          wholeNumber: true,
          min: 1,
          max: 100_000,
        },
        {
          id: 'f_groups',
          type: 'multiple_choice',
          label: 'Who will benefit?',
          options: [
            { value: 'young', label: 'Young people' },
            { value: 'older', label: 'Older people' },
            { value: 'families', label: 'Families' },
          ],
          minSelections: 1,
          maxSelections: 2,
        },
        {
          id: 'f_region',
          type: 'dropdown',
          label: 'Region',
          options: [
            { value: 'north', label: 'North' },
            { value: 'south', label: 'South' },
          ],
        },
      ],
    },
    {
      id: 's_building',
      title: 'Planning',
      conditions: [{ field: 'f_kind', equals: 'building' }],
      fields: [{ id: 'f_planning', type: 'yes_no', label: 'Do you have planning permission?' }],
    },
    {
      id: 's_monitoring',
      title: 'Equality monitoring',
      fields: [
        { id: 'f_intro', type: 'content', body: 'Reviewers never see these answers.' },
        {
          id: 'f_ethnicity',
          type: 'single_choice',
          label: 'Which group best describes the people who lead your organisation?',
          audiences: 'aggregate_only',
          options: [
            { value: 'one', label: 'Group one' },
            { value: 'two', label: 'Group two' },
          ],
        },
      ],
    },
  ],
};

export const exampleForm = formDefinitionSchema.parse(exampleInput);

/** Valid answers to every question, with building work chosen. */
export const exampleAnswers = {
  f_charity: true,
  f_orgname: 'Northfield Community Trust',
  f_email: 'hello@northfield.example',
  f_phone: '01632 960 001',
  f_address: { line1: '1 High Street', town: 'Northfield', postcode: 'NF1 1AA' },
  f_site: 'https://www.northfield.example',
  f_kind: 'building',
  f_works: 'A new roof for the community hall.',
  f_amount: { amountMinor: 1_500_000, currency: 'GBP' },
  f_start: '2027-04-01',
  f_people: 250,
  f_groups: ['young', 'families'],
  f_region: 'north',
  f_planning: true,
  f_ethnicity: 'two',
};
