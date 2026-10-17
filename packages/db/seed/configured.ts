// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Scenario `configured`, the default for `pnpm dev`: `base`, plus
// Northfield's Community Spaces Fund, open, with one round from 12 October to
// 2 November 2026 in Europe/London, its three stages, a rubric of three
// weighted criteria on Review, version 1 of its application form, published,
// and version 1 of each outcome's email, which is the text every new
// programme starts with.

import { base } from './base.ts';
import type { Programme, Scenario } from './scenario.ts';

/** Version 1 of the round's application form, as the form editor saves it. */
export const communitySpacesForm = {
  sections: [
    {
      id: 's_eligibility',
      title: 'Check you can apply',
      fields: [
        {
          id: 'f_local',
          type: 'yes_no',
          label: 'Does your group run a space in Northfield that local people use?',
          required: true,
          eligibility: {
            stopWhen: false,
            explanation: 'This fund is for groups that run a space in Northfield for local people.',
          },
        },
      ],
    },
    {
      id: 's_project',
      title: 'Your project',
      fields: [
        {
          id: 'f_title',
          type: 'short_text',
          label: 'Project name',
          required: true,
          maxCharacters: 120,
        },
        {
          id: 'f_summary',
          type: 'long_text',
          label: 'What will you do, and who will it help?',
          required: true,
          maxWords: 500,
        },
        {
          id: 'f_amount',
          type: 'currency',
          label: 'How much are you asking for?',
          hint: 'Between £5,000 and £25,000.',
          required: true,
          minMinor: 5_000_00,
          maxMinor: 25_000_00,
        },
      ],
    },
    {
      id: 's_budget',
      title: 'Budget',
      fields: [
        {
          id: 'f_budget',
          type: 'table',
          label: 'What will the grant pay for?',
          hint: 'Add a row for each cost.',
          required: true,
          rowNoun: 'cost',
          minRows: 1,
          columns: [
            { id: 'c_item', type: 'short_text', label: 'Item' },
            { id: 'c_cost', type: 'currency', label: 'Cost', total: true },
          ],
        },
      ],
    },
    {
      id: 's_documents',
      title: 'Documents',
      fields: [
        {
          id: 'f_accounts',
          type: 'file',
          label: 'Your latest annual accounts',
          hint: 'A PDF or spreadsheet, up to 10 MB.',
          allowedTypes: [
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.oasis.opendocument.spreadsheet',
          ],
          maxBytes: 10 * 1024 * 1024,
        },
      ],
    },
  ],
};

export const communitySpacesFund: Programme = {
  title: 'Community Spaces Fund',
  summary:
    'Grants of £5,000 to £25,000 for community groups to create, improve or open up the spaces they run for local people.',
  description:
    'We fund village halls, community gardens, sports pavilions and other shared spaces. You can apply for building work, equipment, or changes that make a space easier to reach and use.',
  status: 'open',
  rounds: [
    {
      title: 'Autumn 2026',
      opensAt: '2026-10-12T09:00',
      closesAt: '2026-11-02T17:00',
      timezone: 'Europe/London',
      budgetMinor: 150_000_00,
      awardMinMinor: 5_000_00,
      awardMaxMinor: 25_000_00,
      latePolicy: 'accept_and_flag',
      stages: [
        { name: 'Intake' },
        {
          name: 'Review',
          criteria: [
            {
              label: 'Need',
              guidance:
                'Is there clear evidence that local people need this space, or need it changed?',
              weight: 3,
            },
            {
              label: 'Approach',
              guidance:
                'Is the plan realistic, with a timetable and, where it is needed, the agreement of whoever owns the space?',
              weight: 2,
            },
            {
              label: 'Value for money',
              guidance:
                'Are the costs reasonable and explained, and is other funding or help in kind used well?',
              weight: 1,
            },
          ],
        },
        { name: 'Decision' },
      ],
      form: communitySpacesForm,
    },
  ],
  templates: {
    accepted: {
      subject: '{{programme_title}}: we are offering you a grant',
      body: [
        'Dear {{given_name}},',
        '',
        'Thank you for applying to {{programme_title}} ({{round_title}}) for {{organisation_name}}.',
        '',
        'We are pleased to offer you a grant of {{award_amount}}.',
        '',
        'Sign in to see the offer and what happens next:',
        '{{portal_link}}',
      ].join('\n'),
    },
    waitlisted: {
      subject: '{{programme_title}}: your application is on our waiting list',
      body: [
        'Dear {{given_name}},',
        '',
        'Thank you for applying to {{programme_title}} ({{round_title}}) for {{organisation_name}}.',
        '',
        'We cannot offer you a grant yet, but your application is on our waiting list. If we can offer you a grant from this round, we will email you.',
        '',
        'Sign in to see your application:',
        '{{portal_link}}',
      ].join('\n'),
    },
    declined: {
      subject: '{{programme_title}}: the decision on your application',
      body: [
        'Dear {{given_name}},',
        '',
        'Thank you for applying to {{programme_title}} ({{round_title}}) for {{organisation_name}}.',
        '',
        'We have decided not to offer you a grant this time.',
        '',
        'Sign in to see your application:',
        '{{portal_link}}',
      ].join('\n'),
    },
  },
};

export const configured: Scenario = base.map((tenant) =>
  tenant.slug === 'northfield' ? { ...tenant, programmes: [communitySpacesFund] } : tenant,
);
