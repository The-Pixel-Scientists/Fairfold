// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A date answer is text like 2027-03-27. The person types it in three boxes,
// so what they have typed can be a date that is not complete or not real.
// Such text is passed on in the same order, year then month then day, and the
// engine says what is wrong.

export interface DateParts {
  day: string;
  month: string;
  year: string;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const EMPTY: DateParts = { day: '', month: '', year: '' };

/** The boxes for a date answer. */
export function dateParts(answer: unknown): DateParts {
  if (typeof answer !== 'string') return EMPTY;
  const iso = ISO_DATE.exec(answer);
  if (iso !== null) {
    return { day: String(Number(iso[3])), month: String(Number(iso[2])), year: iso[1] ?? '' };
  }
  const [year, month, day, ...rest] = answer.split('-');
  if (rest.length > 0 || year === undefined || month === undefined || day === undefined) {
    return EMPTY;
  }
  return { day, month, year };
}

/** A date for boxes that hold digits in the right places, null for empty boxes, or the boxes joined as typed. */
export function dateAnswer({ day, month, year }: DateParts): string | null {
  const [d, m, y] = [day.trim(), month.trim(), year.trim()];
  if (d === '' && m === '' && y === '') return null;
  if (/^\d{1,2}$/.test(d) && /^\d{1,2}$/.test(m) && /^\d{4}$/.test(y)) {
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return `${y}-${m}-${d}`;
}
