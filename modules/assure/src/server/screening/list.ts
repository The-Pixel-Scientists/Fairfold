// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The sanctions list as downloaded (ADR 0031): read strictly, then checked
// as a whole before anything is stored. Only the fields the product uses
// are taken, so whatever else the file carries is dropped. A file with any
// row that does not fit is refused whole, never loaded in part, and nothing
// from the file travels into an error. Each name is normalised here, by the
// function the matcher uses, as it becomes a row.

import {
  day,
  list as objects,
  raw,
  Refused,
  refuse,
  required,
  text,
  type Raw,
} from '../registries/parse.ts';
import { normaliseName } from './normalise.ts';

/** Fewer designations than this is not the whole list (the real list holds thousands). */
export const MIN_DESIGNATIONS = 1000;
/** A list with more than this fraction fewer rows than the current version is refused (ADR 0031). */
export const MAX_DROP = 0.1;
export const MAX_DESIGNATIONS = 50_000;
export const MAX_NAMES = 50;

export type ListFailure = 'list_refused' | 'list_too_small' | 'list_duplicates' | 'list_shrank';

const KINDS = ['individual', 'entity', 'ship'] as const;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9/._-]{0,39}$/;
const PARTIAL_DATE = /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/;

/** A date that exists, as `YYYY-MM-DD`, or null when absent. */
function realDay(from: Raw, key: string): string | null {
  const value = day(from, key);
  if (value !== null && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    return refuse();
  }
  return value;
}

/** A list of short strings of at most `max`, or refuses. */
function strings(from: Raw, key: string, max: number, length: number): string[] {
  const value = from[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > max) return refuse();
  return value.map((item) => text({ item }, 'item', length) ?? refuse());
}

interface Designation {
  readonly id: string;
  readonly kind: (typeof KINDS)[number];
  readonly regime: string;
  readonly designatedOn: string | null;
  readonly names: readonly { readonly type: 'primary' | 'alias'; readonly name: string }[];
  readonly datesOfBirth: readonly string[];
  readonly nationalities: readonly string[];
  readonly country: string | null;
}

/** One designation, with only the fields the product uses. */
function readDesignation(from: Raw): Designation {
  const id = required(from, 'id', 40);
  const kind = KINDS.find((candidate) => candidate === from['kind']) ?? refuse();
  const names = objects(from, 'names', MAX_NAMES).map((entry): Designation['names'][number] => ({
    type: entry['type'] === 'primary' ? 'primary' : entry['type'] === 'alias' ? 'alias' : refuse(),
    name: required(entry, 'name', 300),
  }));
  const datesOfBirth = strings(from, 'datesOfBirth', 20, 10);
  if (
    !SAFE_ID.test(id) ||
    names.filter(({ type }) => type === 'primary').length !== 1 ||
    !datesOfBirth.every((date) => PARTIAL_DATE.test(date))
  ) {
    return refuse();
  }
  return {
    id,
    kind,
    regime: required(from, 'regime', 200),
    designatedOn: realDay(from, 'designatedOn'),
    names,
    datesOfBirth,
    nationalities: strings(from, 'nationalities', 20, 100),
    country: text(from, 'country', 100),
  };
}

/** One row of `assure.sanctions_entry` as the loader takes it. */
export interface EntryRow {
  readonly designation_id: string;
  readonly entry_kind: 'individual' | 'entity' | 'ship';
  readonly name_type: 'primary' | 'alias';
  readonly name: string;
  readonly normalised_name: string;
  readonly regime: string;
  readonly designated_on: string | null;
  readonly dates_of_birth: readonly string[];
  readonly nationalities: readonly string[];
  readonly country: string | null;
}

export type CheckedList =
  | { readonly ok: true; readonly publishedOn: string; readonly rows: readonly EntryRow[] }
  | { readonly ok: false; readonly failure: ListFailure };

/**
 * The file's text as rows, or the reason it was refused. `currentRows` is the
 * live version's row count, or null when there is none.
 */
export function checkList(
  body: string,
  currentRows: number | null,
  minimum: number = MIN_DESIGNATIONS,
): CheckedList {
  let file: Raw;
  let designations: readonly Designation[];
  let publishedOn: string;
  try {
    file = raw(JSON.parse(body));
    publishedOn = realDay(file, 'publishedOn') ?? refuse();
    designations = objects(file, 'designations', MAX_DESIGNATIONS).map(readDesignation);
  } catch (error) {
    if (error instanceof Refused || error instanceof SyntaxError) {
      return { ok: false, failure: 'list_refused' };
    }
    throw error;
  }
  if (designations.length < minimum) return { ok: false, failure: 'list_too_small' };
  if (new Set(designations.map(({ id }) => id)).size !== designations.length) {
    return { ok: false, failure: 'list_duplicates' };
  }
  const rows = designations.flatMap((entry): EntryRow[] => {
    const individual = entry.kind === 'individual';
    const kind = individual ? 'person' : 'organisation';
    return entry.names.map(({ type, name }) => ({
      designation_id: entry.id,
      entry_kind: entry.kind,
      name_type: type,
      name,
      normalised_name: normaliseName(name, kind),
      regime: entry.regime,
      designated_on: entry.designatedOn ?? null,
      dates_of_birth: individual ? entry.datesOfBirth : [],
      nationalities: individual ? entry.nationalities : [],
      country: individual ? (entry.country ?? null) : null,
    }));
  });
  if (rows.some((row) => row.normalised_name === '')) return { ok: false, failure: 'list_refused' };
  if (currentRows !== null && rows.length < currentRows * (1 - MAX_DROP)) {
    return { ok: false, failure: 'list_shrank' };
  }
  return { ok: true, publishedOn, rows };
}
