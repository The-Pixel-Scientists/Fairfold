// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Dates and words for kinds, states and classes, as docs/CONTENT-STYLE.md
// writes them: "1 April 2027".

import type {
  MonitoringBreakdown,
  PublicationKind,
  PublicationState,
  ReportKind,
} from '../contracts/index.ts';

const MONTHS = [
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
] as const;

/** "1 April 2027" for `2027-04-01` or a time on that day (London's, as people read it). */
export function formatDate(value: string): string {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : new Date(value).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const [year = '', month = '', date = ''] = day.split('-');
  return `${String(Number(date))} ${MONTHS[Number(month) - 1] ?? month} ${year}`;
}

export const reportKindLabels: Record<ReportKind, string> = {
  warehouse: 'Warehouse report',
  monitoring: 'Equality monitoring report',
};

export const breakdownLabels: Record<MonitoringBreakdown, string> = {
  outcome: 'Outcome',
  stage_reached: 'Stage reached',
};

export const publicationKindLabels: Record<PublicationKind, string> = {
  three_sixty_giving: '360Giving publication',
  sorp_grant_note: 'SORP grant-making note (draft)',
  annual_return: 'Annual return figures (draft)',
};

export const publicationStateLabels: Record<PublicationState, string> = {
  preparing: 'Preparing',
  prepared: 'Ready to review',
  failed: 'Could not be prepared',
  submitted: 'Submitted',
};

export const classLabels = { public: 'Public', internal: 'Internal' } as const;

/** "Total_amount" style names read as words: `source_module` is "Source module". */
export function plainName(name: string): string {
  const words = name.replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
