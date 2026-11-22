// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The words and formats the privacy screens use. Dates and times are shown in
// the funder's time zone, never the browser's, and every status is text.

import type {
  Breach,
  DataCategory,
  RightsRequest,
  clockStates,
  closeReasons,
  dataCategories,
  dpiaStatuses,
  extensionReasons,
  identityChecks,
  lateReasons,
  legalBases,
  likelihoods,
  notificationMethods,
  pauseReasons,
  requestChannels,
  requestKinds,
  resumeReasons,
  riskLevels,
  screeningAnswers,
  severities,
  specialCategoryConditions,
  subjectCategories,
  transferSafeguards,
} from '../contracts/index.ts';
import { breachClock, calendarDateIn, specialCategoryData } from '../contracts/index.ts';

type Words<T extends readonly string[]> = Readonly<Record<T[number], string>>;

export const kindWords: Words<typeof requestKinds> = {
  access: 'Access',
  rectification: 'Rectification',
  erasure: 'Erasure',
  restriction: 'Restriction',
  portability: 'Portability',
  objection: 'Objection',
  automated_decision: 'Automated decision',
  complaint: 'Complaint',
};

export const channelWords: Words<typeof requestChannels> = {
  email: 'Email',
  post: 'Post',
  phone: 'Phone',
  in_person: 'In person',
  web_form: 'Web form',
  social_media: 'Social media',
  other: 'Another way',
};

export const identityWords: Words<typeof identityChecks> = {
  not_started: 'Not started',
  requested: 'Proof asked for',
  verified: 'Verified',
  not_needed: 'Not needed',
  failed: 'Failed',
};

/** Why the clock stopped, as the end of "Clock stopped on 4 January 2027: ...". */
export const pauseWords: Words<typeof pauseReasons> = {
  identity_proof: 'waiting for proof of identity',
  clarification: 'waiting for the person to clarify the request',
};

export const resumeWords: Words<typeof resumeReasons> = {
  information_received: 'the information has arrived',
  no_longer_needed: 'the information is no longer needed',
};

export const extensionWords: Words<typeof extensionReasons> = {
  complex: 'the request is complex',
  numerous: 'the person made several requests',
};

export const closeWords: Words<typeof closeReasons> = {
  completed: 'completed',
  refused: 'refused',
  withdrawn: 'withdrawn by the person',
  identity_not_confirmed: 'identity not confirmed',
};

export const riskWords: Words<typeof riskLevels> = {
  unlikely: 'Unlikely to risk people',
  risk: 'A risk to people',
  high_risk: 'A high risk to people',
};

export const lateWords: Words<typeof lateReasons> = {
  still_investigating: 'Still investigating',
  processor_reported_late: 'A processor told us late',
  reported_in_phases: 'Reported in phases',
  other: 'Another reason',
};

export const methodWords: Words<typeof notificationMethods> = {
  email: 'Email',
  post: 'Post',
  phone: 'Phone',
  in_person: 'In person',
};

export const categoryWords: Words<typeof dataCategories> = {
  identity: 'Identity',
  contact: 'Contact details',
  financial: 'Financial',
  location: 'Location',
  online_identifiers: 'Online identifiers',
  children: "Children's data",
  criminal_offences: 'Criminal offences',
  racial_or_ethnic_origin: 'Racial or ethnic origin',
  political_opinions: 'Political opinions',
  religious_or_philosophical_beliefs: 'Religious or philosophical beliefs',
  trade_union_membership: 'Trade union membership',
  genetic: 'Genetic data',
  biometric: 'Biometric data',
  health: 'Health',
  sex_life_or_orientation: 'Sex life or sexual orientation',
  other: 'Other',
};

const special: ReadonlySet<string> = new Set(specialCategoryData);

/** A data category in words, saying so when it is special category data. */
export const categoryLabel = (category: DataCategory): string =>
  special.has(category) ? `${categoryWords[category]} (special category)` : categoryWords[category];

export const dpiaWords: Words<typeof dpiaStatuses> = {
  draft: 'Draft',
  in_review: 'In review',
  signed_off: 'Signed off',
  review_due: 'Review due',
};

export const answerWords: Words<typeof screeningAnswers> = {
  yes: 'Yes',
  no: 'No',
  unsure: 'Not sure',
};

export const likelihoodWords: Words<typeof likelihoods> = {
  remote: 'Remote',
  possible: 'Possible',
  probable: 'Probable',
};

export const severityWords: Words<typeof severities> = {
  minimal: 'Minimal',
  significant: 'Significant',
  severe: 'Severe',
};

export const basisWords: Words<typeof legalBases> = {
  consent: 'Consent',
  contract: 'Contract',
  legal_obligation: 'Legal obligation',
  vital_interests: 'Vital interests',
  public_task: 'Public task',
  legitimate_interests: 'Legitimate interests',
  recognised_legitimate_interests: 'Recognised legitimate interests',
};

export const conditionWords: Words<typeof specialCategoryConditions> = {
  explicit_consent: 'Explicit consent',
  employment_and_social_protection: 'Employment and social protection',
  vital_interests: 'Vital interests',
  not_for_profit_body: 'Not-for-profit body',
  made_public_by_subject: 'Made public by the person',
  legal_claims: 'Legal claims',
  substantial_public_interest: 'Substantial public interest',
  health_and_social_care: 'Health and social care',
  public_health: 'Public health',
  archiving_research_statistics: 'Archiving, research and statistics',
};

export const subjectWords: Words<typeof subjectCategories> = {
  applicants: 'Applicants',
  grant_holders: 'Grant holders',
  beneficiaries: 'Beneficiaries',
  staff: 'Staff',
  volunteers: 'Volunteers',
  trustees: 'Trustees',
  donors: 'Donors',
  supporters: 'Supporters',
  contacts: 'Contacts',
  other: 'Other',
};

export const safeguardWords: Words<typeof transferSafeguards> = {
  adequacy_regulations: 'Adequacy regulations',
  international_data_transfer_agreement: 'International data transfer agreement',
  uk_addendum: 'UK addendum',
  binding_corporate_rules: 'Binding corporate rules',
};

const plural = (count: number, unit: string) => `${String(count)} ${unit}${count === 1 ? '' : 's'}`;

const DAY = 86_400_000;

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY;

/** Whole days from one calendar date to another. */
export const daysBetween = (from: string, to: string): number => dayNumber(to) - dayNumber(from);

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** A calendar date such as 2027-01-12 as "12 January 2027". */
export const formatDate = (date: string): string =>
  dateFormat.format(new Date(`${date}T00:00:00Z`));

/** An instant as "3:15pm on 9 December 2026" in the funder's time zone. */
export function formatMoment(instant: string, timeZone: string): string {
  const parts = new Map(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
      .formatToParts(new Date(instant))
      .map(({ type, value }) => [type, value]),
  );
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.get(type) ?? '';
  const period = get('dayPeriod').toLowerCase().replace(/\./g, '');
  return `${get('hour')}:${get('minute')}${period} on ${get('day')} ${get('month')} ${get('year')}`;
}

/** The funder's calendar date for an instant. */
export const todayIn = (now: string, timeZone: string): string => calendarDateIn(now, timeZone);

/** What the rights request clock says, in words. The response decides the state and the date. */
export function clockText(
  clock: RightsRequest['clock'],
  today: string,
  events: RightsRequest['clockEvents'] = [],
): string {
  const { state, dueOn } = clock;
  switch (state) {
    case 'closed': {
      const closed = events.findLast(({ kind }) => kind === 'closed');
      return closed?.kind === 'closed'
        ? `Closed on ${formatDate(closed.on)}: ${closeWords[closed.reason]}`
        : 'Closed';
    }
    case 'paused': {
      const paused = events.findLast(({ kind }) => kind === 'paused');
      return paused?.kind === 'paused'
        ? `Clock stopped on ${formatDate(paused.on)}: ${pauseWords[paused.reason]}`
        : 'Clock stopped: the due date is not known until it restarts';
    }
    case 'overdue':
      return dueOn === null ? 'Overdue' : `Overdue by ${plural(daysBetween(dueOn, today), 'day')}`;
    case 'extended':
      return dueOn === null ? 'Extended' : `Extended to ${formatDate(dueOn)}`;
    case 'running': {
      if (dueOn === null) return 'Due date not known';
      const left = daysBetween(today, dueOn);
      return `Due ${formatDate(dueOn)} (${left === 0 ? 'today' : `${plural(left, 'day')} left`})`;
    }
  }
}

const HOUR = 3_600_000;

/** The ICO clock for an open breach, or what happened, in words. Updates with `now`. */
export function breachClockText(
  breach: Pick<Breach, 'becameAwareAt'> & { icoNotified: boolean; late: boolean },
  now: string,
  timeZone: string,
): string {
  if (breach.icoNotified) return breach.late ? 'ICO told after the deadline' : 'ICO told';
  const { deadline, hoursRemaining } = breachClock(breach.becameAwareAt, null, now);
  const passed = Date.parse(now) > Date.parse(deadline);
  if (!passed) {
    const left = hoursRemaining === 0 ? 'Less than 1 hour' : plural(hoursRemaining, 'hour');
    return `${left} left to tell the ICO, by ${formatMoment(deadline, timeZone)}`;
  }
  const hours = Math.floor((Date.parse(now) - Date.parse(deadline)) / HOUR);
  const ago =
    hours < 1
      ? 'less than an hour'
      : hours < 48
        ? plural(hours, 'hour')
        : plural(Math.floor(hours / 24), 'day');
  return `ICO deadline passed ${ago} ago`;
}

export const deadlinePassed = (becameAwareAt: string, now: string): boolean =>
  breachClock(becameAwareAt, null, now).late;

function offsetMinutes(ms: number, timeZone: string): number {
  const parts = new Map(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
      .formatToParts(new Date(ms))
      .map(({ type, value }) => [type, Number(value)]),
  );
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.get(type) ?? 0;
  const wall = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return (wall - ms) / 60_000;
}

/** A `datetime-local` value, such as 2026-12-07T09:30, read as a time in the funder's zone. Null if it is not a time. */
export function instantFrom(local: string, timeZone: string): string | null {
  const wall = Date.parse(`${local}:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local) || Number.isNaN(wall)) return null;
  const first = wall - offsetMinutes(wall, timeZone) * 60_000;
  return new Date(wall - offsetMinutes(first, timeZone) * 60_000).toISOString();
}

/** An instant as a `datetime-local` value in the funder's zone. */
export function localInput(instant: string, timeZone: string): string {
  const parts = new Map(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(new Date(instant))
      .map(({ type, value }) => [type, value]),
  );
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.get(type) ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

export const stateWords: Words<typeof clockStates> = {
  running: 'Running',
  paused: 'Clock stopped',
  extended: 'Extended',
  overdue: 'Overdue',
  closed: 'Closed',
};

/** A tag's colour is only a hint: the text beside it always says the same. */
export const stateTone = {
  running: 'success',
  paused: 'warning',
  extended: 'info',
  overdue: 'danger',
  closed: 'neutral',
} as const satisfies Record<(typeof clockStates)[number], string>;
