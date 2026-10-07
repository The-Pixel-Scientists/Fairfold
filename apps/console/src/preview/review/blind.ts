// SPDX-License-Identifier: AGPL-3.0-or-later
//
// NF-CG-0398, Friday Night Project, as a reviewer sees it. Review is blind:
// the server sends only the fields reviewers may see, so there is no
// organisation name, no person's name, no contact detail and no due
// diligence here, and nothing in the answers gives them away.

import type { FormAnswers, FormMoney } from '@pixel-scientists/ui';

import { answerSections } from './form.ts';

export const reference = 'NF-CG-0398';
export const project = 'Friday Night Project';

const money = (amount: number): FormMoney => ({ amountMinor: amount * 100, currency: 'GBP' });

/** The answers a reviewer is sent, keyed by the form's ids. The staff-only answers are never in it. */
export const answers: FormAnswers = {
  'charity-registered': true,
  income: money(96_400),
  people: 16,
  'project-name': project,
  'project-summary':
    'A weekly Friday evening club for young people aged 11 to 16, with a hot meal, sport and creative activities, run by trained youth workers.',
  need: 'There is nowhere for young people in our neighbourhood to go on a Friday night. Police figures show anti-social behaviour peaks between 6pm and 10pm on Fridays, and 71 of the 120 young people we surveyed said they are bored and have nothing to do at weekends.',
  activities:
    'From 4 June 2027 we will open our hall every Friday from 6pm to 9.30pm for 40 weeks. Each night offers a hot meal, a choice of football or a creative activity, and a quiet room for homework or talking to a youth worker. Two youth workers and four volunteers run each session, and a coordinator plans the programme. We expect 35 young people each week.',
  'start-date': '2027-06-04',
  'end-date': '2028-03-03',
  venue: 'Our community hall in Eastbrook',
  areas: ['Eastbrook'],
  change:
    'Young people will have a safe, supervised place to spend Friday evenings, eat a hot meal and take part in activities they choose. We expect fewer incidents reported nearby on Fridays and more young people saying they have an adult they trust.',
  participants: 90,
  involvement:
    'Young people chose the activities through a survey and two planning sessions, and four of them will join a monthly steering group.',
  evidence:
    'We will count attendance every week and ask young people to fill in a short feedback card each term. We will ask the police neighbourhood team for Friday evening figures before and after the project.',
  'declaration-agreed': true,
  'declaration-safeguarding': true,
  'declaration-correct': true,
};

/** What a reviewer reads: only the questions reviewers may see. */
export const reviewerForm = answerSections('reviewer', answers);

export const budget = [
  { item: 'Youth workers', detail: '2 workers, 4 hours a night, 40 Fridays at £15', cost: 4_800 },
  { item: 'Coordinator', detail: '8 hours a week for 40 weeks at £16', cost: 5_120 },
  { item: 'Food', detail: '40 Fridays at £120', cost: 4_800 },
  { item: 'Hall hire', detail: '40 Fridays at £45', cost: 1_800 },
  { item: 'Training', detail: 'Safeguarding and first aid for 8 volunteers', cost: 680 },
  { item: 'Equipment', detail: 'Football kit, art supplies and a games table', cost: 1_200 },
] as const;

export const otherFunding = { source: "The group's own fundraising", amount: 400 };
export const requested = budget.reduce((sum, line) => sum + line.cost, 0) - otherFunding.amount;

export interface Entry {
  score: number | null;
  comment: string;
}

/** The review as Owen Hughes left it: two criteria scored, one started and two not yet. */
export const startingEntries: Readonly<Record<string, Entry>> = {
  need: {
    score: 4,
    comment: 'Clear, local evidence from a survey of the young people themselves.',
  },
  approach: {
    score: 3,
    comment: 'Sensible plan, but no timetable for recruiting and training the volunteers.',
  },
  reach: {
    score: null,
    comment: 'Young people shaped the programme, which is good. Not clear how they will reach',
  },
  value: { score: null, comment: '' },
  capacity: { score: null, comment: '' },
};
