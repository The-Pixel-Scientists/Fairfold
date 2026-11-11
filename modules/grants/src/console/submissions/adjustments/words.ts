// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Adjustments in the words of docs/CONTENT-STYLE.md. Closing times are local
// to the round's zone, as the contracts carry them, so they are read from the
// text and never through a Date. Reason codes appear only on these screens.

import { adjustmentKinds, adjustmentReasons, revokeReasons } from '../../../contracts/index.ts';
import type { Adjustment } from '../../../contracts/index.ts';
import { formatLocal, formatMoment } from '../../programme/format.ts';
import type { Moment } from '../../programme/roundDraft.ts';

export const zoneWords = (timeZone: string): string =>
  timeZone === 'Europe/London' ? 'UK time' : timeZone;

/** "2 February 2027 at 9am, UK time". */
export const closingWords = (local: string, timeZone: string): string =>
  `${formatLocal(local)}, ${zoneWords(timeZone)}`;

export const reasonOptions = Object.entries(adjustmentReasons).map(([value, label]) => ({
  value,
  label,
}));

export const revokeOptions = Object.entries(revokeReasons).map(([value, label]) => ({
  value,
  label,
}));

/** What an adjustment gives, for a list: "More time to apply until 2 February 2027 at 9am, UK time". */
export function givenWords(adjustment: Adjustment): string {
  const kind = adjustmentKinds[adjustment.kind];
  return adjustment.closesAt === null
    ? kind
    : `${kind} until ${closingWords(adjustment.closesAt, adjustment.timeZone)}`;
}

/** Who granted it and when: "Ada Reed, 2 February 2027 at 9am". */
export const grantedWords = (adjustment: Adjustment): string =>
  `${adjustment.grantedBy.name ?? 'A team member'}, ${formatMoment(adjustment.grantedAt, adjustment.timeZone)}`;

/** The request's closing time from the date and time boxes, or null while either is missing. */
export function closingOf({ date, time }: Moment): string | null {
  return date !== null && /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time)
    ? `${date}T${time}`
    : null;
}
