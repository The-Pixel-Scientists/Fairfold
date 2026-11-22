// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The wave1 scenario's three tenants. `tools` is both the tools switched on
// and the parts/ files that write the tenant's rows.
//
// Linnetford has every wave 1 tool's data and a closed Neighbourhood Fund
// with two rounds of submitted applications, 62 in Spring 2026 and 10 in
// Summer 2026, for the equality monitoring cells in parts/monitoring.ts.
// Crowmere has grants and nothing else. Sedgebrook has crm and assure, with
// grants off and no programme.
//
// Every name comes from the hand-written lists in ../../names.ts, every
// address ends in .example and every postcode is fictional
// (../../synthetic.ts). Applicant i is the same person on every run.

import type { Application, Round } from '../../scenario.ts';
import {
  familyNames,
  givenNames,
  organisationKinds,
  places,
  projects,
  streets,
} from '../../names.ts';
import { fictionalPostcode } from '../../synthetic.ts';
import { communitySpacesFund } from '../../configured.ts';
import type { Wave1Tenant } from './write.ts';

const at = <T>(list: readonly T[], index: number): T => {
  const item = list[index % list.length];
  if (item === undefined) throw new Error('A wave 1 list is empty.');
  return item;
};

/** Version 1 of the Neighbourhood Fund's application form. */
export const neighbourhoodForm = {
  sections: [
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
          id: 'f_amount',
          type: 'currency',
          label: 'How much are you asking for?',
          hint: 'Between £1,000 and £10,000.',
          required: true,
          minMinor: 1_000_00,
          maxMinor: 10_000_00,
        },
      ],
    },
  ],
};

/** Applicant `i`, their organisation and their answers, submitted on `day` of `month`. */
function application(i: number, month: string): Application {
  const [title, legalForm] = at(organisationKinds, i);
  const place = at(places, i * 7);
  const day = String(2 + (i % 25)).padStart(2, '0');
  return {
    applicant: [at(givenNames, i), at(familyNames, i + Math.floor(i / givenNames.length) * 13)],
    organisation: {
      name: title.replace('{place}', place),
      legalForm,
      addressLine1: `${String((i % 90) + 1)} ${at(streets, i)}`,
      town: place,
      postcode: fictionalPostcode(1_000 + i),
    },
    answers: {
      f_title: at(projects, i)[0],
      f_amount: { amountMinor: (1 + (i % 9)) * 1_000_00, currency: 'GBP' },
    },
    startedAt: `2026-${month}-${day}T10:00`,
    submittedAt: `2026-${month}-${day}T16:30`,
    stage: 'Intake',
  };
}

const applications = (from: number, count: number, month: string) =>
  Array.from({ length: count }, (_, n) => application(from + n, month));

const round = (title: string, opensAt: string, closesAt: string, list: Application[]): Round => ({
  title,
  opensAt,
  closesAt,
  timezone: 'Europe/London',
  budgetMinor: 200_000_00,
  awardMinMinor: 1_000_00,
  awardMaxMinor: 10_000_00,
  latePolicy: 'refuse',
  stages: [{ name: 'Intake' }, { name: 'Decision' }],
  form: neighbourhoodForm,
  applications: list,
});

export const wave1Tenants: readonly Wave1Tenant[] = [
  {
    slug: 'linnetford',
    name: 'Linnetford Community Foundation',
    tools: ['grants', 'crm', 'assure', 'forms', 'privacy', 'insight'],
    staff: [
      ['Bethan', 'Nowak', 'tenant_admin'],
      ['Imran', 'Fraser', 'programme_manager'],
      ['Lowri', 'Owusu', 'due_diligence_officer'],
      ['Wiktor', 'Desai', 'data_protection_lead'],
      ['Hana', 'Reid', 'analyst'],
      ['Joel', 'Mensah', 'reviewer'],
    ],
    programmes: [
      {
        title: 'Neighbourhood Fund',
        summary: 'Grants of £1,000 to £10,000 for groups that bring neighbours together.',
        description:
          'We fund community groups in Linnetford and the villages around it for projects that bring people together.',
        status: 'closed',
        rounds: [
          round('Spring 2026', '2026-03-02T09:00', '2026-04-10T17:00', applications(0, 62, '03')),
          round('Summer 2026', '2026-06-01T09:00', '2026-07-03T17:00', applications(62, 10, '06')),
        ],
        templates: communitySpacesFund.templates,
      },
    ],
  },
  {
    slug: 'crowmere',
    name: 'Crowmere Trust',
    tools: ['grants'],
    staff: [
      ['Esther', 'Kowalski', 'tenant_admin'],
      ['Rhys', 'Iqbal', 'programme_manager'],
    ],
  },
  {
    slug: 'sedgebrook',
    name: 'Sedgebrook Partnership',
    tools: ['crm', 'assure'],
    staff: [
      ['Farah', 'Lloyd', 'tenant_admin'],
      ['Gethin', 'Sandhu', 'programme_manager'],
      ['Uma', 'Walsh', 'due_diligence_officer'],
    ],
  },
];
