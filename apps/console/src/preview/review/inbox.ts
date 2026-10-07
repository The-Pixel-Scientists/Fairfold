// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Owen Hughes's reviews on 17 March 2027: the sixteen applications assigned to
// him since 5 March, twelve submitted and four to do. Review is blind, so this
// holds references and the projects' own titles, never an organisation.

import { reviewer as owen } from '../story.ts';

export type ReviewState = 'Not started' | 'In progress' | 'Submitted';

export interface Assignment {
  reference: string;
  state: ReviewState;
  due: string;
  /** When Owen submitted it, for a submitted review. */
  submitted?: string;
}

export const reviewer = owen.name;

const due = '24 March 2027';

export const assignments: readonly Assignment[] = [
  { reference: 'NF-CG-0398', state: 'In progress', due },
  { reference: 'NF-CG-0418', state: 'In progress', due },
  { reference: 'NF-CG-0430', state: 'Not started', due },
  { reference: 'NF-CG-0389', state: 'Not started', due },
  { reference: 'NF-CG-0436', state: 'Submitted', due, submitted: '16 March 2027' },
  { reference: 'NF-CG-0408', state: 'Submitted', due, submitted: '15 March 2027' },
  { reference: 'NF-CG-0427', state: 'Submitted', due, submitted: '12 March 2027' },
  { reference: 'NF-CG-0400', state: 'Submitted', due, submitted: '11 March 2027' },
  { reference: 'NF-CG-0385', state: 'Submitted', due, submitted: '11 March 2027' },
  { reference: 'NF-CG-0421', state: 'Submitted', due, submitted: '10 March 2027' },
  { reference: 'NF-CG-0409', state: 'Submitted', due, submitted: '10 March 2027' },
  { reference: 'NF-CG-0358', state: 'Submitted', due, submitted: '9 March 2027' },
  { reference: 'NF-CG-0377', state: 'Submitted', due, submitted: '8 March 2027' },
  { reference: 'NF-CG-0343', state: 'Submitted', due, submitted: '8 March 2027' },
  { reference: 'NF-CG-0365', state: 'Submitted', due, submitted: '6 March 2027' },
  { reference: 'NF-CG-0356', state: 'Submitted', due, submitted: '6 March 2027' },
];
