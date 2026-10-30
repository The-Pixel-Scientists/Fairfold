// SPDX-License-Identifier: AGPL-3.0-or-later
//
// How the grants warehouse readers turn stored values into rows' values.

/** A time as ISO 8601 text. */
export const iso = (time: Date): string => time.toISOString();

export const isoOrNull = (time: Date | null): string | null => (time === null ? null : iso(time));

/** A value a database check requires, such as the amount of an accepted decision. */
export function required<T>(value: T | null): T {
  if (value === null) throw new Error('A stored value that the database requires is missing.');
  return value;
}
