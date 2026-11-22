// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Readers for a register's raw response (ADR 0031): each takes one named
// field, checks its type and size, and refuses the whole response by
// throwing `Refused` when it does not fit. Only the fields a reader names
// are ever taken, so nothing else a register sends is passed on. The result
// is then checked again against the contract's strict schema, which refuses
// hidden characters, bad dates and over-long text before anything is stored.
// `Refused` carries nothing from the response.

import type { LookupOutcome } from '../../contracts/index.ts';
import { HIDDEN } from '../../contracts/schemas.ts';

export class Refused extends Error {
  override name = 'Refused';
}

export type Raw = Readonly<Record<string, unknown>>;

export const refuse = (): never => {
  throw new Refused('The response was refused.');
};

export const isRaw = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The value as an object, or refuses. */
export const raw = (value: unknown): Raw => (isRaw(value) ? value : refuse());

const absent = (value: unknown): boolean => value === undefined || value === null;

/** A trimmed line of at most `max` characters, or null when absent or blank. */
export function text(from: Raw, key: string, max: number): string | null {
  const value = from[key];
  if (absent(value)) return null;
  if (typeof value !== 'string' || value.length > max || HIDDEN.test(value)) return refuse();
  return value.trim() === '' ? null : value.trim();
}

/** Like text(), but the field must be there. */
export const required = (from: Raw, key: string, max: number): string =>
  text(from, key, max) ?? refuse();

/** A date, or the date of a timestamp, as `YYYY-MM-DD`. */
export function day(from: Raw, key: string): string | null {
  const value = from[key];
  if (absent(value)) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T[\d:.]{1,16}Z?)?$/.test(value)) {
    return refuse();
  }
  return value.slice(0, 10);
}

/** Whole pounds, never negative, as a register files them: returned as pence. */
export function pence(from: Raw, key: string): number | null {
  const value = from[key];
  if (absent(value)) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 1e11) {
    return refuse();
  }
  return value * 100;
}

export function flag(from: Raw, key: string): boolean | null {
  const value = from[key];
  if (absent(value)) return null;
  return typeof value === 'boolean' ? value : refuse();
}

/** A whole number from 0. */
export function count(from: Raw, key: string): number {
  const value = from[key];
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : refuse();
}

/** A list of objects of at most `max`: more is refused, never cut short. */
export function list(from: Raw, key: string, max: number): readonly Raw[] {
  const value = from[key];
  if (absent(value)) return [];
  if (!Array.isArray(value) || value.length > max) return refuse();
  return (value as unknown[]).map(raw);
}

/** Runs a reader, turning a refusal into the contract's failure. */
export function parsed(read: () => LookupOutcome): LookupOutcome {
  try {
    return read();
  } catch (error) {
    if (error instanceof Refused) return { ok: false, failure: 'response_refused' };
    throw error;
  }
}
