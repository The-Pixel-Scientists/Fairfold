// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Scenario `applications`, for working on triage and assessment:
// `configured`, with Northfield's round moved back so it ran from
// 7 September to 5 October 2026, and six submitted applications from
// synthetic groups across its three stages. One was submitted late, which
// the round's policy accepts and flags, and one was withdrawn. Each answers
// every question but the optional accounts file, since the seed stores no
// files.

import { base } from './base.ts';
import { communitySpacesFund } from './configured.ts';
import type { Application, Organisation, Scenario } from './scenario.ts';

/** An organisation in Northfield. */
const group = (name: string, legalForm: string, addressLine1: string, postcode: string) =>
  ({ name, legalForm, addressLine1, town: 'Northfield', postcode }) satisfies Organisation;

const pounds = (amount: number) => ({ amountMinor: amount * 100, currency: 'GBP' });

/** Answers to the Community Spaces Fund form, asking for the budget's total. */
function answers(title: string, summary: string, costs: readonly [string, number][]) {
  const total = costs.reduce((sum, [, cost]) => sum + cost, 0);
  return {
    f_local: true,
    f_title: title,
    f_summary: summary,
    f_amount: pounds(total),
    f_budget: costs.map(([item, cost]) => ({ c_item: item, c_cost: pounds(cost) })),
  };
}

const submitted: readonly Application[] = [
  {
    applicant: ['Grace', 'Okafor'],
    organisation: group('Westgate Village Hall', 'registered_charity', '2 Westgate', 'NF2 4HL'),
    answers: answers(
      'A kitchen for the village hall',
      'We will replace the hall kitchen so the lunch club and parent groups can cook for up to 60 people.',
      [
        ['Kitchen units and worktops', 7_500],
        ['Cooker and extractor', 4_200],
        ['Fitting and electrics', 3_300],
      ],
    ),
    startedAt: '2026-09-14T10:20',
    submittedAt: '2026-09-29T19:05',
    stage: 'Intake',
  },
  {
    applicant: ['Tom', 'Bradley'],
    organisation: group(
      'Brook Street Youth Club',
      'unincorporated_group',
      '41 Brook Street',
      'NF1 3QS',
    ),
    answers: answers(
      'Open the youth club on Saturdays',
      'We will add a Saturday session with new sports equipment and a safer entrance.',
      [
        ['Sports equipment', 2_800],
        ['Entrance door and lighting', 3_900],
      ],
    ),
    startedAt: '2026-10-01T16:45',
    submittedAt: '2026-10-05T17:25',
    stage: 'Intake',
  },
  {
    applicant: ['Lena', 'Fischer'],
    organisation: group(
      'Northfield Allotment Society',
      'community_benefit_society',
      'Allotment Lane',
      'NF3 1AB',
    ),
    answers: answers(
      'A shared tool shed and accessible beds',
      'We will build raised beds that wheelchair users can reach, and a shed so members can share tools.',
      [
        ['Raised beds', 6_400],
        ['Tool shed', 3_100],
        ['Path surfacing', 4_500],
      ],
    ),
    startedAt: '2026-09-08T09:30',
    submittedAt: '2026-09-21T12:10',
    stage: 'Review',
  },
  {
    applicant: ['Samir', 'Haddad'],
    organisation: group(
      'Northfield Rovers Football Club',
      'company_limited_by_guarantee',
      'Rovers Ground, Mill Road',
      'NF4 6RD',
    ),
    answers: answers(
      'Changing rooms for girls and women',
      'We will turn a store room into a second changing room so girls and women can train at the same time as other teams.',
      [
        ['Building work', 14_000],
        ['Showers and plumbing', 5_500],
      ],
    ),
    startedAt: '2026-09-10T20:00',
    submittedAt: '2026-10-02T21:40',
    stage: 'Review',
  },
  {
    applicant: ['Joan', 'Whitfield'],
    organisation: group(
      'Friends of Elm Park',
      'charitable_incorporated_organisation',
      'The Lodge, Elm Park',
      'NF2 8EP',
    ),
    answers: answers(
      'Reopen the park lodge as a community room',
      'We will repair the lodge roof and heating so local groups can meet in the park all year.',
      [
        ['Roof repairs', 11_800],
        ['Heating', 6_200],
      ],
    ),
    startedAt: '2026-09-07T11:15',
    submittedAt: '2026-09-18T15:30',
    stage: 'Decision',
  },
  {
    applicant: ['Kwame', 'Mensah'],
    organisation: group(
      'Northfield Repair Cafe',
      'unincorporated_group',
      "St Anne's Church Hall, Church Road",
      'NF1 9CR',
    ),
    answers: answers(
      'Workbenches for the repair cafe',
      'We will fit workbenches and storage so volunteers can fix more items at each monthly session.',
      [
        ['Workbenches', 3_600],
        ['Storage and tools', 2_400],
      ],
    ),
    startedAt: '2026-09-15T18:00',
    submittedAt: '2026-09-24T18:50',
    withdrawnAt: '2026-09-30T08:15',
    stage: 'Intake',
  },
];

const [autumn] = communitySpacesFund.rounds;
if (!autumn) throw new Error('The Community Spaces Fund has no round.');

export const applications: Scenario = base.map((tenant) =>
  tenant.slug === 'northfield'
    ? {
        ...tenant,
        programmes: [
          {
            ...communitySpacesFund,
            rounds: [
              {
                ...autumn,
                opensAt: '2026-09-07T09:00',
                closesAt: '2026-10-05T17:00',
                applications: submitted,
              },
            ],
          },
        ],
      }
    : tenant,
);
