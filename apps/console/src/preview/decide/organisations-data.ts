// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The organisations list, as at 26 March 2027. Spring 2027 decisions are
// recorded but private, so they are not grants yet. Area and Spring 2027
// applications are counted from the story; only what the story says about
// earlier rounds is added here.

import { applications, charityNumber } from '../story.ts';

interface Entry {
  name: string;
  /** Null for a group that is not a registered charity. */
  charityNumber: string | null;
  /** Applications in rounds before Spring 2027, and drafts for other programmes. */
  otherApplications?: number;
  /** Grants already awarded, in pounds. */
  grants?: readonly number[];
  /** The path of its record, where there is a preview of one. */
  record?: string;
}

/** The numbers are far above any the Charity Commission has issued, so they belong to no charity. */
const entries: readonly Entry[] = [
  {
    name: 'Northfield Community Trust',
    charityNumber,
    otherApplications: 2,
    grants: [8_000],
    record: '/organisations/northfield-community-trust',
  },
  { name: "St Anne's Food Pantry", charityNumber: '1999241' },
  { name: 'Eastbrook Youth Collective', charityNumber: '1999318' },
  { name: 'Sandford Village Hall', charityNumber: '1999127' },
  { name: "Northfield Carers' Network", charityNumber: '1999385' },
  { name: 'The Lantern Arts Project', charityNumber: null },
  { name: "Millbrook Men's Shed", charityNumber: null },
];

export interface OrganisationRow {
  name: string;
  charityNumber: string | null;
  area: string;
  applications: number;
  /** How many grants, and what they came to, in pounds. */
  grants: number;
  awarded: number;
  record?: string;
}

export const organisationRows: readonly OrganisationRow[] = entries.map((entry) => {
  const spring = applications.filter((application) => application.organisation === entry.name);
  const grants = entry.grants ?? [];
  return {
    name: entry.name,
    charityNumber: entry.charityNumber,
    area: spring[0]?.area ?? '',
    applications: spring.length + (entry.otherApplications ?? 0),
    grants: grants.length,
    awarded: grants.reduce((sum, amount) => sum + amount, 0),
    ...(entry.record !== undefined && { record: entry.record }),
  };
});
