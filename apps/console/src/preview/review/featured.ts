// SPDX-License-Identifier: AGPL-3.0-or-later
//
// NF-CG-0412, Riverside Lunch Club: the application the submission detail
// screen opens, with its checks, notes and history. Everything here is staff
// information; the scoring workspace has its own, blind, copy of an application.

import type { FormAnswers, FormMoney } from '@pixel-scientists/ui';

import { charityNumber, featuredBudget, pounds } from '../story.ts';
import { answerSections, formVersion } from './form.ts';

export const reference = 'NF-CG-0412';

const money = (amount: number): FormMoney => ({ amountMinor: amount * 100, currency: 'GBP' });

/** The answers to the form's questions, keyed by their ids. Equality answers are not here: no one reads them one by one. */
export const answers: FormAnswers = {
  'org-name': 'Northfield Community Trust',
  'charity-registered': true,
  'charity-number': charityNumber,
  address: 'Riverside Hall, Mill Lane, Northfield, NF1 3QR',
  'contact-name': 'Sam Patel',
  'contact-email': 'sam@example.org',
  'contact-phone': '01632 960412',
  income: money(184_200),
  people: 44,
  'project-name': 'Riverside Lunch Club',
  'project-summary':
    'A hot three-course lunch every Tuesday at Riverside Hall for people aged 65 and over who live alone.',
  need: 'Northfield Central has more older people living alone than anywhere else in the county. In our 2026 survey of 112 residents aged 65 and over, 6 in 10 said they eat their main meal alone most days, and 4 in 10 had not left home on at least three days that week. Our Tuesday coffee morning is always full, and 23 people are waiting for a lunch place that does not exist yet.',
  activities:
    'From 1 June 2027 we will serve a hot three-course lunch for up to 40 people every Tuesday for 48 weeks. A paid cook leads a rota of eight trained volunteers. A minibus brings 12 people who cannot get to the hall. After lunch there is something optional to join: a quiz, gentle exercise, or a visit from an adviser on benefits and health services.',
  'start-date': '2027-06-01',
  'end-date': '2028-04-25',
  venue: 'Riverside Hall, Mill Lane, Northfield',
  areas: ['Northfield Central'],
  change:
    'People will eat a hot meal with company at least once a week, make friends, and hear about benefits and health services they may be missing. We expect most regular guests to tell us they feel less lonely after six months.',
  participants: 120,
  involvement:
    'Guests chose the format in our 2026 survey, and four of them will join a planning group that meets once a month to choose the menus and activities.',
  evidence:
    'We will ask guests to complete a short loneliness scale when they join and again after six months, and keep a register of who comes. We will report numbers, the change in scores and three guest stories at the end of the grant.',
  'declaration-agreed': true,
  'declaration-safeguarding': true,
  'declaration-correct': true,
};

/** What staff read: every question but the equality ones, including the staff-only ones. */
export const staffForm = answerSections('staff', answers);

export const budget = featuredBudget;
export const budgetTotal = budget.reduce((sum, line) => sum + line.cost, 0);
export const otherFunding = { source: 'Northfield Parish Council', amount: 1_000 };
export const requested = budgetTotal - otherFunding.amount;

export const documents = [
  { name: 'Accounts 2025 to 2026.pdf', kind: 'Your latest accounts', size: '1.2 MB' },
  { name: 'Constitution.pdf', kind: 'Your constitution', size: '836 KB' },
  { name: 'Safeguarding policy.docx', kind: 'Your safeguarding policy', size: '3.2 MB' },
  { name: 'Parish council letter.pdf', kind: 'Evidence of other funding', size: '210 KB' },
] as const;

export const eligibility = [
  {
    rule: 'Is a registered charity, a CIC or a constituted community group',
    evidence: `Registered charity ${charityNumber}`,
  },
  {
    rule: 'Is based in the Northfield area',
    evidence: 'The registered address, NF1 3QR, is inside the area',
  },
  {
    rule: 'Asks for between £1,000 and £25,000',
    evidence: `Asks for ${pounds(requested)}`,
  },
  {
    rule: 'Has annual accounts from the last 12 months',
    evidence: 'Accounts 2025 to 2026 uploaded',
  },
  { rule: 'Has a safeguarding policy', evidence: 'Policy uploaded' },
  {
    rule: 'Has no overdue reports on earlier grants',
    evidence: 'The Autumn 2026 report is not due until 1 June 2027',
  },
] as const;

export const trustees = [
  'Margaret Hale (chair)',
  'Joyce Adeyemi (treasurer)',
  'Ravi Menon',
  'Joanna Whitlock',
  'Elaine Brooks',
  'Hassan Qureshi',
  'Pauline Doyle',
] as const;

export interface Check {
  name: string;
  result: string;
  tone: 'success' | 'neutral';
  detail: string;
  source: string;
  checked: string;
}

export const checks: readonly Check[] = [
  {
    name: 'Charity Commission register',
    result: 'Registered',
    tone: 'success',
    detail: `Registered charity ${charityNumber}, income band £100,000 to £250,000.`,
    source: 'Charity Commission for England and Wales',
    checked: '2 March 2027',
  },
  {
    name: 'Accounts filed on time',
    result: 'On time',
    tone: 'success',
    detail:
      'Accounts for the year to 31 March 2026 were filed on 18 December 2026, before the 31 January 2027 deadline.',
    source: 'Charity Commission for England and Wales',
    checked: '2 March 2027',
  },
  {
    name: 'Trustees listed',
    result: 'Listed',
    tone: 'success',
    detail: 'Seven trustees are on the register.',
    source: 'Charity Commission for England and Wales',
    checked: '2 March 2027',
  },
  {
    name: 'Companies House',
    result: 'Not a company',
    tone: 'neutral',
    detail: 'No company is linked to this charity, so there are no company accounts to check.',
    source: 'Companies House',
    checked: '2 March 2027',
  },
  {
    name: 'Sanctions screening',
    result: 'No matches',
    tone: 'success',
    detail: 'The organisation and its seven trustees do not appear on the UK Sanctions List.',
    source: 'UK Sanctions List (FCDO)',
    checked: '2 March 2027',
  },
  {
    name: 'Bank details',
    result: 'Confirmed',
    tone: 'success',
    detail:
      'The account name and number match the bank statement the treasurer sent on 3 March 2027. Entered by Ada Morgan and confirmed by a second person, Marcus Bell.',
    source: 'Bank statement and a call to the treasurer',
    checked: '3 March 2027',
  },
];

export const comments = [
  {
    reviewer: 'Priya Shah',
    submitted: '9 March 2027',
    text: 'The strongest plan for isolated older people in this batch. The need is well evidenced and the costs are clear. The weakest part is how they will measure change: a recognised loneliness scale is good, but they say little about how many guests will complete it.',
  },
  {
    reviewer: 'Hannah Lewis',
    submitted: '11 March 2027',
    text: 'Strong need and a realistic plan. Value for money is good at £2.50 a lunch, and eight trained volunteers give the project depth. I would fund it in full.',
  },
  {
    reviewer: 'Tom Okafor',
    submitted: '15 March 2027',
    text: 'A well-evidenced proposal from a group that already runs the hall. The budget is clear and the minibus costs are sensible. I would like to know how they will reach people who do not already come to the coffee morning.',
  },
] as const;

export interface Note {
  author: string;
  when: string;
  text: string;
}

export const notes: readonly Note[] = [
  {
    author: 'Ada Morgan',
    when: '11 March 2027, 3:05pm',
    text: 'Spoke to Sam Patel about the minibus. A volunteer driver rota is in place and the public liability insurance covers it. No concerns.',
  },
  {
    author: 'Marcus Bell',
    when: '3 March 2027, 11:40am',
    text: 'Bank details match the bank statement the treasurer sent. Confirmed by phone with Joyce Adeyemi, the treasurer.',
  },
  {
    author: 'Ada Morgan',
    when: '2 March 2027, 10:15am',
    text: 'Existing grantee: Winter Warm Space (NF-CG-0291), Autumn 2026, £8,000. Its end-of-grant report is not due until 1 June 2027, so nothing is outstanding.',
  },
];

export const history = [
  { when: '16 March 2027, 9:48am', what: 'Moved to Shortlisted', who: 'Ada Morgan' },
  { when: '15 March 2027, 4:30pm', what: 'Review submitted', who: 'Tom Okafor' },
  { when: '11 March 2027, 3:05pm', what: 'Note added', who: 'Ada Morgan' },
  { when: '11 March 2027, 11:52am', what: 'Review submitted', who: 'Hannah Lewis' },
  { when: '9 March 2027, 2:12pm', what: 'Review submitted', who: 'Priya Shah' },
  {
    when: '5 March 2027, 11:20am',
    what: 'Reviewers assigned: Priya Shah, Hannah Lewis and Tom Okafor. Moved to In review',
    who: 'Ada Morgan',
  },
  { when: '3 March 2027, 11:40am', what: 'Bank details confirmed', who: 'Marcus Bell' },
  {
    when: '2 March 2027, 10:42am',
    what: 'Due diligence checks run. Sanctions screening found no matches',
    who: 'Ada Morgan',
  },
  {
    when: '2 March 2027, 10:15am',
    what: 'Eligibility confirmed: 6 of 6 checks passed',
    who: 'Ada Morgan',
  },
  {
    when: '1 March 2027, 2:14pm',
    what: `Application submitted against form version ${String(formVersion.number)}`,
    who: 'Sam Patel',
  },
] as const;
