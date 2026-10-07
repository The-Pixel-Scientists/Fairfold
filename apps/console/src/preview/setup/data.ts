// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the setup previews need beyond story.ts, consistent with it: the
// programmes list, the Spring 2027 round's stages, dates and settings, and
// the configuration history. Programmes, the rubric and the form builder are
// set at 15 February 2027. Community Grants and the round page are set at
// 17 March 2027.

import type { TagTone } from '@pixel-scientists/ui';

import { range, rows, sum, WIDE_SPREAD } from '../review/data.ts';
import { applications, communityGrants, funder, moments, programmes, reviewers } from '../story.ts';
import type { Round, RoundStatus } from '../story.ts';

const months = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** A date as the story writes it, such as "3 March 2027, 5pm", as a number that sorts: 20270303. */
export function sortableDate(text: string): number {
  const [day = '', month = '', year = ''] = (text.split(',')[0] ?? '').split(' ');
  return Number(year) * 10_000 + (months.indexOf(month) + 1) * 100 + Number(day);
}

/** A date without its time: "3 March 2027". */
export function dateOnly(text: string): string {
  return text.split(',')[0] ?? text;
}

export const roundTone: Record<RoundStatus, TagTone> = {
  Draft: 'neutral',
  Open: 'info',
  Closed: 'neutral',
  Assessing: 'info',
  Deciding: 'info',
  Complete: 'success',
};

/** Millions as the dashboard writes them: £1.87m, £1.2m. */
export function millions(amount: number): string {
  return `£${String(Math.round(amount / 10_000) / 100)}m`;
}

const [spring] = communityGrants.rounds;
if (!spring) throw new Error('The story has no Spring 2027 round.');
export const springRound: Round = spring;

/** Where a round's page is. */
export const roundPath = (id: string): string => `/programmes/${communityGrants.id}/${id}`;

// Programmes

const nextSteps: Record<string, string> = {
  'community-grants': 'Open until 3 March 2027',
  'green-spaces': 'Open until 26 April 2027',
  'youth-futures': 'Publish the form and rubric',
  hardship: 'Release decisions on 19 February',
};

/** The date the rubric and the form builder are set at: "15 February 2027". */
export const today = moments.applying.toLocaleDateString('en-GB', { dateStyle: 'long' });

/** The applications to Spring 2027 that have come in by then. */
export const receivedSoFar = applications.filter(
  (application) => new Date(application.submitted) <= moments.applying,
).length;

/**
 * The story's statuses are as at 17 March 2027. On 15 February 2027 Spring 2027
 * is open, and Winter 2026 waits for its decisions to be released.
 */
const onTheDay: Record<string, Partial<Round>> = {
  'spring-2027': { status: 'Open', applications: receivedSoFar },
  'hardship-2026': { status: 'Deciding' },
};

const programmesNow = programmes.map((programme) => ({
  ...programme,
  rounds: programme.rounds.map((round) => ({ ...round, ...onTheDay[round.id] })),
}));

export interface ProgrammeRow {
  id: string;
  name: string;
  awards: string;
  round: Round;
  next: string;
}

export const programmeRows: readonly ProgrammeRow[] = programmesNow.flatMap((programme) => {
  const [round] = programme.rounds;
  return round
    ? [
        {
          id: programme.id,
          name: programme.name,
          awards: `Awards of £${round.minimumAward.toLocaleString('en-GB')} to £${round.maximumAward.toLocaleString('en-GB')}`,
          round,
          next: nextSteps[programme.id] ?? '',
        },
      ]
    : [];
});

const rounds = programmesNow.flatMap((programme) => programme.rounds);

/** Only these have a page in the preview; the others show as plain text. */
export const hasPage = {
  programme: (id: string): boolean => id === communityGrants.id,
  round: (id: string): boolean => id === springRound.id,
};

const unfinished = rounds.filter((round) => round.status !== 'Complete');

/** Budget in every round that is not finished, drafts included. */
export const currentBudget = {
  total: unfinished.reduce((sum, round) => sum + round.budget, 0),
  detail: `${String(unfinished.length)} rounds, ${String(unfinished.filter((round) => round.status === 'Draft').length)} still in draft`,
};

const open = programmesNow.flatMap((programme) =>
  programme.rounds.filter((round) => round.status === 'Open').map(() => programme.name),
);

/** Rounds taking applications, with their programmes: "Community Grants and Green Spaces Fund". */
export const roundsOpen = {
  count: open.length,
  detail: new Intl.ListFormat('en-GB').format(open),
};

export const awardedSince2024 = 1_200_000;

const roundOf = (id: string): Round => {
  const found = rounds.find((round) => round.id === id);
  if (!found) throw new Error(`The story has no round ${id}.`);
  return found;
};

export interface Milestone {
  date: string;
  programme: string;
  what: string;
}

/** What happens next across every programme, from 15 February 2027, in date order. */
export const comingUp: readonly Milestone[] = [
  {
    date: '19 February 2027',
    programme: 'Emergency Hardship Fund',
    what: 'Winter 2026 decisions are released',
  },
  {
    date: dateOnly(springRound.closes),
    programme: 'Community Grants',
    what: 'Spring 2027 closes to applications',
  },
  { date: '24 March 2027', programme: 'Community Grants', what: 'Spring 2027 reviews are due' },
  {
    date: '26 March 2027',
    programme: 'Community Grants',
    what: 'Spring 2027 decision panel meets',
  },
  {
    date: dateOnly(roundOf('green-2027').closes),
    programme: 'Green Spaces Fund',
    what: '2027 round closes to applications',
  },
  {
    date: '30 April 2027',
    programme: 'Community Grants',
    what: 'Last day to release Spring 2027 decisions',
  },
  {
    date: dateOnly(roundOf('summer-2027').opens),
    programme: 'Community Grants',
    what: 'Summer 2027 opens to applications',
  },
  {
    date: dateOnly(roundOf('youth-2027').opens),
    programme: 'Youth Futures',
    what: '2027 to 2030 opens to applications',
  },
];

// Spring 2027, as it stands on 17 March 2027 and counted from the story.

export const figures = {
  received: applications.length,
  eligible: applications.filter((application) => application.ineligible === undefined).length,
  requested: sum(applications.map((application) => application.requested)),
  assigned: sum(applications.map((application) => application.reviews.length)),
  submitted: sum(applications.map((application) => application.inBy17March)),
  shortlisted: applications.filter((application) => application.statusOn17March === 'Shortlisted')
    .length,
};

/** Reviews each reviewer still has to submit, most first. */
const owed = reviewers
  .map(({ name, assigned, submittedBy17March }) => ({ name, count: assigned - submittedBy17March }))
  .sort((a, b) => b.count - a.count);

export const reviewersToChase = owed.filter((reviewer) => reviewer.count > 0).length;

export const reviewsToFinish = figures.assigned - figures.submitted;

const wide = rows.filter((row) => range(row) >= WIDE_SPREAD);

export const keyDates = [
  { event: 'Round opened', date: '2 February 2027, 9am', when: 'Done' },
  { event: 'Round closed', date: '3 March 2027, 5pm', when: 'Done' },
  { event: 'Reviews due', date: '24 March 2027', when: 'In 7 days' },
  { event: 'Decision panel meets', date: '26 March 2027', when: 'In 9 days' },
  { event: 'Decisions released by', date: '30 April 2027', when: 'In 44 days' },
] as const;

export interface Stage {
  id: string;
  name: string;
  count: number;
  caption: string;
  state: 'Done' | 'Current stage' | 'Not started';
  purpose: string;
  who: string;
  exit: string;
}

export const stages: readonly Stage[] = [
  {
    id: 'intake',
    name: 'Intake',
    count: figures.received,
    caption: 'applications received',
    state: 'Done',
    purpose: 'Applicants complete the form and submit it before the round closes.',
    who: 'Applicants',
    exit: 'The application is submitted',
  },
  {
    id: 'eligibility',
    name: 'Eligibility',
    count: figures.eligible,
    caption: `eligible, ${String(figures.received - figures.eligible)} not`,
    state: 'Done',
    purpose: 'Automatic checks, then a member of staff confirms each application can go forward.',
    who: 'Programme managers',
    exit: 'Staff mark the application eligible',
  },
  {
    id: 'review',
    name: 'Review',
    count: figures.eligible,
    caption: `${String(figures.submitted)} of ${String(figures.assigned)} reviews done, ${String(figures.shortlisted)} shortlisted`,
    state: 'Current stage',
    purpose:
      'Three reviewers score each application against the rubric, without seeing who applied.',
    who: 'Reviewers',
    exit: 'All three reviews are submitted',
  },
  {
    id: 'decision',
    name: 'Decision',
    count: 0,
    caption: 'decisions recorded',
    state: 'Not started',
    purpose:
      'The panel recommends amounts and records decisions, which stay private until release.',
    who: 'Programme managers and administrators',
    exit: 'Decisions are released',
  },
];

export const nextToDo = [
  {
    title: `${String(reviewsToFinish)} reviews to finish`,
    detail: `${owed
      .slice(0, 2)
      .map(({ name, count }, index) => `${name} has ${String(count)}${index === 0 ? ' to go' : ''}`)
      .join(' and ')}. Reviews are due on 24 March 2027.`,
    to: '/reviews/spread',
    link: 'See reviewer progress',
  },
  {
    title: `${String(wide.length)} applications have a wide spread of scores`,
    detail: `${new Intl.ListFormat('en-GB').format(wide.map((row) => row.reference))} have reviewers ${String(WIDE_SPREAD)} points or more apart.`,
    to: '/reviews/spread',
    link: 'Compare the scores',
  },
  {
    title: `${String(figures.shortlisted)} applications are shortlisted`,
    detail: 'Applications that average 3.5 or more are shortlisted once all three reviews are in.',
    to: '/submissions',
    link: 'See the shortlist',
  },
  {
    title: 'Recommend amounts before the panel meets',
    detail: 'The decision panel meets on 26 March 2027.',
    to: '/decisions',
    link: 'Go to decisions',
  },
];

export const emails = [
  {
    name: 'Application received',
    to: 'Applicant',
    when: 'The applicant submits',
    version: 1,
    changed: '12 January 2027',
  },
  {
    name: 'Eligibility result',
    to: 'Applicant',
    when: 'Staff finish the eligibility check',
    version: 1,
    changed: '12 January 2027',
  },
  {
    name: 'Review invitation',
    to: 'Reviewer',
    when: 'A reviewer is assigned',
    version: 1,
    changed: '12 January 2027',
  },
  {
    name: 'Decision: awarded',
    to: 'Applicant',
    when: 'You release decisions, and not before',
    version: 1,
    changed: '12 January 2027',
  },
  {
    name: 'Decision: waitlisted',
    to: 'Applicant',
    when: 'You release decisions, and not before',
    version: 2,
    changed: '24 February 2027',
  },
  {
    name: 'Decision: declined',
    to: 'Applicant',
    when: 'You release decisions, and not before',
    version: 1,
    changed: '12 January 2027',
  },
] as const;

export const roundSettings = [
  { term: 'Award range', value: '£1,000 to £25,000' },
  { term: 'Budget', value: '£250,000' },
  { term: 'Reviewers for each application', value: '3' },
  {
    term: 'Blind review',
    value: 'On. Reviewers see answers without names, contact details or documents.',
  },
  { term: 'Conflicts of interest', value: 'Reviewers declare a conflict before they score' },
  { term: 'Late applications', value: 'Not accepted after the round closes' },
  { term: 'Decisions', value: 'Private until you release them' },
  { term: 'Applicant link', value: 'https://apply.northfield.example/community-grants' },
] as const;

// Programme

export const programmeDetails = [
  {
    term: 'Purpose',
    value:
      'Fund projects that bring people together in Northfield and the villages around it, such as lunch clubs, youth work, arts and growing spaces.',
  },
  {
    term: 'Who can apply',
    value:
      'Registered charities, community interest companies and community groups with a governing document and a bank account in the group’s name. Not individuals, schools or councils.',
  },
  {
    term: 'Area',
    value:
      'Northfield Central, Eastbrook, Hartley Green, Millbrook, Sandford, Westfield and Oakmere',
  },
  { term: 'Award range', value: '£1,000 to £25,000, for up to 12 months' },
  { term: 'Assessment', value: 'Blind review by three reviewers, then a decision panel' },
  {
    term: 'Reviewer pool',
    value: 'Priya Shah, Tom Okafor, Hannah Lewis, Daniel Price, Grace Mbeki and Owen Hughes',
  },
  { term: 'Programme contact', value: `Grants team, ${funder.email}` },
] as const;

export interface ConfigChange {
  what: string;
  detail: string;
  who: string;
  when: string;
  iso: string;
  /** The diff: each field with its value before and after. */
  changes: readonly { field: string; before: string; after: string }[];
}

/** Every change to a programme, round, stage, rubric, form or email is a config version (architecture rule 10). */
export const configHistory: readonly ConfigChange[] = [
  {
    what: 'Spring 2027 email changed',
    detail: 'Decision: waitlisted is now version 2. It says what happens if funds are freed up.',
    who: 'Ada Morgan',
    when: '24 February 2027, 4:05pm',
    iso: '2027-02-24T16:05',
    changes: [
      {
        field: 'Decision: waitlisted, second paragraph',
        before: 'We cannot offer you a grant in this round.',
        after:
          'We cannot offer you a grant yet. If funds are freed up, we will write to you by 30 June 2027.',
      },
    ],
  },
  {
    what: 'Summer 2027 round created',
    detail: 'Created from Spring 2027. It stays a draft until its form is published.',
    who: 'Ada Morgan',
    when: '9 February 2027, 2:20pm',
    iso: '2027-02-09T14:20',
    changes: [{ field: 'Copied from', before: 'Nothing', after: 'Spring 2027' }],
  },
  {
    what: 'Spring 2027 form published, version 3',
    detail: 'Budget table rows raised from 10 to 12.',
    who: 'Ada Morgan',
    when: '1 February 2027, 10:12am',
    iso: '2027-02-01T10:12',
    changes: [{ field: 'Costs of the project, most rows', before: '10', after: '12' }],
  },
  {
    what: 'Spring 2027 rubric saved, version 2',
    detail:
      'Need weight raised from 2 to 3 and Capacity to deliver cut from 2 to 1. Weights still total 10.',
    who: 'Ada Morgan',
    when: '28 January 2027, 3:40pm',
    iso: '2027-01-28T15:40',
    changes: [
      { field: 'Need, weight', before: '2', after: '3' },
      { field: 'Capacity to deliver, weight', before: '2', after: '1' },
    ],
  },
  {
    what: 'Spring 2027 stage changed',
    detail: 'Review now needs 3 reviewers for each application, up from 2.',
    who: 'Marcus Bell',
    when: '20 January 2027, 11:18am',
    iso: '2027-01-20T11:18',
    changes: [{ field: 'Review, reviewers for each application', before: '2', after: '3' }],
  },
  {
    what: 'Spring 2027 round created',
    detail: 'Created from Autumn 2026, with its form, rubric and emails.',
    who: 'Ada Morgan',
    when: '12 January 2027, 9:30am',
    iso: '2027-01-12T09:30',
    changes: [{ field: 'Copied from', before: 'Nothing', after: 'Autumn 2026' }],
  },
  {
    what: 'Programme changed',
    detail: 'Largest award raised from £20,000 to £25,000.',
    who: 'Marcus Bell',
    when: '18 August 2026, 2:02pm',
    iso: '2026-08-18T14:02',
    changes: [{ field: 'Largest award', before: '£20,000', after: '£25,000' }],
  },
  {
    what: 'Programme created',
    detail: 'Community Grants set up, with its grants since 2024 imported.',
    who: 'Marcus Bell',
    when: '3 July 2026, 10:00am',
    iso: '2026-07-03T10:00',
    changes: [{ field: 'Award range', before: 'Not set', after: '£1,000 to £20,000' }],
  },
];
