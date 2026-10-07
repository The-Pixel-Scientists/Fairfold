// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A sample of 40 events from the Spring 2027 round, as the audit log lists
// them, not every event. Every reviewer named here is on that application's
// panel, and every export matches one in the export history on the reports page.

export interface AuditChange {
  field: string;
  before: string;
  after: string;
}

export interface AuditEvent {
  id: string;
  /** `2027-04-02T09:14`. */
  at: string;
  who: string;
  action: string;
  target: string;
  /** What the event changed. Events that change nothing, such as signing in, have none. */
  changes?: readonly AuditChange[];
}

const change = (field: string, before: string, after: string): AuditChange => ({
  field,
  before,
  after,
});

const invited = (id: string, at: string, who: string, email: string): AuditEvent => ({
  id,
  at,
  who,
  action: 'Member invited',
  target: email,
  changes: [change('Roles', 'None', 'Reviewer')],
});

const log: readonly AuditEvent[] = [
  {
    id: 'evt_7Qk2m9',
    at: '2027-04-02T09:20',
    who: 'Marcus Bell',
    action: 'Signed in',
    target: 'Console, password and authenticator app',
  },
  {
    id: 'evt_7Qk1c4',
    at: '2027-04-02T09:14',
    who: 'Ada Morgan',
    action: 'Export downloaded',
    target: '360Giving file, CSV: 14 grants',
  },
  {
    id: 'evt_7Qk1b8',
    at: '2027-04-02T09:14',
    who: 'Ada Morgan',
    action: 'Export downloaded',
    target: '360Giving file, JSON: 14 grants',
  },
  {
    id: 'evt_7Qjx52',
    at: '2027-04-02T08:52',
    who: 'Ada Morgan',
    action: 'Signed in',
    target: 'Console, password and authenticator app',
  },
  {
    id: 'evt_7Px9k2',
    at: '2027-04-01T16:40',
    who: 'Marcus Bell',
    action: 'Export downloaded',
    target: 'Applications, CSV: 41 applications',
  },
  {
    id: 'evt_7Pw4d1',
    at: '2027-04-01T14:06',
    who: 'Ada Morgan',
    action: 'Decisions released',
    target: 'Spring 2027: 41 applicants told',
    changes: [
      change('Decision state', 'Recorded (private)', 'Released'),
      change('Applicants told', '0', '41'),
    ],
  },
  {
    id: 'evt_7Pw4a7',
    at: '2027-04-01T14:05',
    who: 'Ada Morgan',
    action: 'Identity confirmed',
    target: 'Step-up check for Release decisions',
  },
  invited('evt_7Nm0b4', '2027-03-31T09:10', 'Sunita Rao', 'fatima.noor@example.org'),
  {
    id: 'evt_7Nk0t6',
    at: '2027-03-31T09:03',
    who: 'Sunita Rao',
    action: 'Signed in',
    target: 'Console, password and authenticator app',
  },
  {
    id: 'evt_7Mp3r8',
    at: '2027-03-30T10:12',
    who: 'Sunita Rao',
    action: 'Rubric changed',
    target: 'Community Grants, Summer 2027',
    changes: [
      change('Version', '1', '2'),
      change('Weight of Reach', '2', '3'),
      change('Weight of Approach', '2', '1'),
    ],
  },
  {
    id: 'evt_7Nm8h3',
    at: '2027-03-26T16:20',
    who: 'Ada Morgan',
    action: 'Decision recorded',
    target: 'NF-CG-0398, Friday Night Project',
    changes: [change('Recommended amount', '£18,000', '£15,000')],
  },
  {
    id: 'evt_7Nm8c9',
    at: '2027-03-26T16:12',
    who: 'Ada Morgan',
    action: 'Decision recorded',
    target: 'NF-CG-0418, Accessible toilets and ramp',
    changes: [
      change('Decision', 'Accept', 'Waitlist'),
      change('Recommended amount', '£24,500', 'None'),
    ],
  },
  {
    id: 'evt_7Nm7d2',
    at: '2027-03-26T16:05',
    who: 'Ada Morgan',
    action: 'Decisions recorded',
    target: 'Spring 2027: 39 applications in one step',
    changes: [
      change('Accept', '0', '13'),
      change('Waitlist', '0', '5'),
      change('Decline', '0', '21'),
    ],
  },
  {
    id: 'evt_7Nm6f2',
    at: '2027-03-26T15:47',
    who: 'Marcus Bell',
    action: 'Decision recorded',
    target: 'NF-CG-0412, Riverside Lunch Club',
    changes: [
      change('Decision', 'None', 'Accept'),
      change('Recommended amount', 'None', '£12,500'),
    ],
  },
  {
    id: 'evt_7Nm6a5',
    at: '2027-03-26T15:31',
    who: 'Marcus Bell',
    action: 'Decision recorded',
    target: 'NF-CG-0365, English conversation cafés',
    changes: [
      change('Decision', 'None', 'Accept'),
      change('Recommended amount', 'None', '£22,000'),
    ],
  },
  {
    id: 'evt_7Kb2w4',
    at: '2027-03-10T09:15',
    who: 'Ada Morgan',
    action: 'Reviewer assigned',
    target: 'Owen Hughes to NF-CG-0430',
    changes: [
      change(
        'Reviewers',
        'Hannah Lewis, Tom Okafor, Grace Mbeki',
        'Hannah Lewis, Tom Okafor, Owen Hughes',
      ),
    ],
  },
  {
    id: 'evt_7Kb1x7',
    at: '2027-03-09T16:02',
    who: 'Grace Mbeki',
    action: 'Conflict declared',
    target: 'NF-CG-0430',
    changes: [change('Review', 'Not started', 'Conflict declared')],
  },
  {
    id: 'evt_7Jh9n3',
    at: '2027-03-24T16:09',
    who: 'Daniel Price',
    action: 'Review submitted',
    target: 'NF-CG-0389, review 3 of 3',
    changes: [change('Review', 'In progress', 'Submitted')],
  },
  {
    id: 'evt_7Jh2m6',
    at: '2027-03-23T11:41',
    who: 'Tom Okafor',
    action: 'Review submitted',
    target: 'NF-CG-0430, review 2 of 3',
    changes: [change('Review', 'In progress', 'Submitted')],
  },
  {
    id: 'evt_7Gd4y8',
    at: '2027-03-16T09:48',
    who: 'Tom Okafor',
    action: 'Review submitted',
    target: 'NF-CG-0377, review 3 of 3',
    changes: [change('Review', 'In progress', 'Submitted')],
  },
  {
    id: 'evt_7Jh5q1',
    at: '2027-03-15T16:30',
    who: 'Tom Okafor',
    action: 'Review submitted',
    target: 'NF-CG-0412, review 3 of 3',
    changes: [change('Review', 'In progress', 'Submitted')],
  },
  {
    id: 'evt_7Dc6p2',
    at: '2027-03-08T16:30',
    who: 'Marcus Bell',
    action: 'Eligibility confirmed',
    target: 'Spring 2027: 41 eligible, 7 ineligible',
  },
  {
    id: 'evt_7Cb4j9',
    at: '2027-03-05T10:42',
    who: 'Ada Morgan',
    action: 'Reviewer assigned',
    target: 'Priya Shah, Tom Okafor and Owen Hughes to NF-CG-0398',
    changes: [change('Reviewers', 'None', 'Priya Shah, Tom Okafor, Owen Hughes')],
  },
  {
    id: 'evt_7Bz8s3',
    at: '2027-03-04T17:20',
    who: 'Ada Morgan',
    action: 'Export downloaded',
    target: 'Applications, CSV: 48 applications',
  },
  {
    id: 'evt_7Cb7k5',
    at: '2027-03-05T11:20',
    who: 'Ada Morgan',
    action: 'Reviewer assigned',
    target: 'Priya Shah, Hannah Lewis and Tom Okafor to NF-CG-0412',
    changes: [change('Reviewers', 'None', 'Priya Shah, Hannah Lewis, Tom Okafor')],
  },
  {
    id: 'evt_7Bq0a1',
    at: '2027-03-03T17:00',
    who: 'System',
    action: 'Round closed',
    target: 'Spring 2027: 48 applications received',
    changes: [change('Round', 'Open', 'Closed')],
  },
  {
    id: 'evt_7Bk5v8',
    at: '2027-03-03T11:38',
    who: 'Marcus Bell',
    action: 'Bank details viewed',
    target: 'NF-CG-0412, Northfield Community Trust',
  },
  invited('evt_7Aw3e6', '2027-03-01T10:05', 'Ada Morgan', 'owen.hughes@example.org'),
  {
    id: 'evt_6Tr8w2',
    at: '2027-02-24T16:05',
    who: 'Ada Morgan',
    action: 'Email changed',
    target: 'Spring 2027, Decision: waitlisted',
    changes: [
      change('Version', '1', '2'),
      change(
        'Second paragraph',
        'We cannot offer you a grant in this round.',
        'We cannot offer you a grant yet. If funds are freed up, we will write to you by 30 June 2027.',
      ),
    ],
  },
  invited('evt_6Qm4d7', '2027-02-15T14:11', 'Ada Morgan', 'daniel.price@example.org'),
  invited('evt_6Qm4c3', '2027-02-15T14:09', 'Ada Morgan', 'grace.mbeki@example.org'),
  invited('evt_6Qm4b9', '2027-02-15T14:07', 'Ada Morgan', 'hannah.lewis@example.org'),
  invited('evt_6Qm4a2', '2027-02-15T14:05', 'Ada Morgan', 'tom.okafor@example.org'),
  invited('evt_6Qm49x', '2027-02-15T14:03', 'Ada Morgan', 'priya.shah@example.org'),
  {
    id: 'evt_6Mk3c8',
    at: '2027-02-09T14:20',
    who: 'Ada Morgan',
    action: 'Round created',
    target: 'Summer 2027, from Spring 2027',
    changes: [change('Copied from', 'Nothing', 'Spring 2027')],
  },
  {
    id: 'evt_6Mh2k5',
    at: '2027-02-02T09:00',
    who: 'System',
    action: 'Round opened',
    target: 'Spring 2027: open for applications',
    changes: [change('Round', 'Draft', 'Open')],
  },
  {
    id: 'evt_6Mg7b1',
    at: '2027-02-01T10:12',
    who: 'Ada Morgan',
    action: 'Form published',
    target: 'Spring 2027, version 3',
    changes: [change('Costs of the project, most rows', '10', '12')],
  },
  {
    id: 'evt_6Jp1n6',
    at: '2027-01-28T15:40',
    who: 'Ada Morgan',
    action: 'Rubric changed',
    target: 'Community Grants, Spring 2027',
    changes: [
      change('Version', '1', '2'),
      change('Weight of Need', '2', '3'),
      change('Weight of Capacity to deliver', '2', '1'),
    ],
  },
  {
    id: 'evt_6Hc9r4',
    at: '2027-01-20T11:18',
    who: 'Marcus Bell',
    action: 'Stage changed',
    target: 'Spring 2027, Review',
    changes: [change('Reviewers for each application', '2', '3')],
  },
  {
    id: 'evt_6Gb3t8',
    at: '2027-01-12T09:30',
    who: 'Ada Morgan',
    action: 'Round created',
    target: 'Spring 2027, from Autumn 2026',
    changes: [change('Copied from', 'Nothing', 'Autumn 2026')],
  },
];

/** Newest first. The log is append-only, so this is also the order the entries were made in. */
export const events: readonly AuditEvent[] = [...log].sort((a, b) => b.at.localeCompare(a.at));

/** The first page of the log. */
export const pageSize = 25;
