// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A configuration version in words. A diff lists each changed value by its
// path (`budget.amountMinor`, `stages.<id>.name`,
// `stages.<id>.criteria.<id>.weight`, `emailTemplates.accepted.subject`)
// with its old and new values. Here a path becomes a label and a value
// becomes what a person would say, with stages and criteria named when
// their names are known.

import { formatMoney } from '@pixel-scientists/domain/platform';

import { latePolicies, outcomes, programmeStatuses } from '../../contracts/index.ts';
import type { ConfigDiff, ConfigValue, ConfigVersion } from '../../contracts/index.ts';
import { formatLocal } from './format.ts';

/** Names of stages and criteria by id. */
export type Names = ReadonlyMap<string, string>;

export interface ChangeWords {
  /** What changed, for a summary: `budget`, `stage “Review”`, `accepted email`. */
  subject: string;
  /** The value changed, in sentence case: `Budget`, `Stage “Review”: name`. */
  field: string;
  before: string;
  after: string;
}

const MONEY: Readonly<Record<string, string>> = {
  budget: 'budget',
  awardMinimum: 'smallest award',
  awardMaximum: 'largest award',
};

const FIELDS: Readonly<Record<string, string>> = {
  title: 'title',
  summary: 'summary',
  description: 'description',
  status: 'status',
  opensAt: 'opening date and time',
  closesAt: 'closing date and time',
  timeZone: 'time zone',
  latePolicy: 'late applications',
  name: 'name',
  position: 'position',
  label: 'label',
  guidance: 'guidance',
  weight: 'weight',
  scaleMin: 'lowest score',
  scaleMax: 'highest score',
  subject: 'subject',
  body: 'text',
  version: 'version',
};

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** "a, b and c". */
function list(items: readonly string[]): string {
  return items.length < 2
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`;
}

/** The names in `known` and in these changes: a stage's `name` and a criterion's `label`, new or old. */
export function namesIn(changes: ConfigDiff, known: Names = new Map()): Names {
  const names = new Map(known);
  for (const { path, from, to } of changes) {
    const parts = path.split('.');
    const name = to ?? from;
    const last = parts[parts.length - 1];
    const id = parts[parts.length - 2];
    if (typeof name === 'string' && id !== undefined && ID.test(id)) {
      if (last === 'name' || last === 'label') names.set(id, name);
    }
  }
  return names;
}

function nameOf(names: Names, id: string | undefined, kind: string): string {
  const name = id === undefined ? undefined : names.get(id);
  return name === undefined ? `a ${kind}` : `${kind} “${name}”`;
}

function labelOf(path: readonly string[], names: Names): { subject: string; field: string } {
  const [first = '', second, third, fourth, fifth] = path;
  if (first in MONEY) {
    const label = MONEY[first] ?? first;
    const field = second === 'currency' ? `${label} currency` : label;
    return { subject: label, field: capitalise(field) };
  }
  if (first === 'stages') {
    const stage = nameOf(names, second, 'stage');
    if (third === 'criteria') {
      const criterion = nameOf(names, fourth, 'criterion');
      const field = `${criterion} in ${stage}: ${FIELDS[fifth ?? ''] ?? fifth ?? ''}`;
      return { subject: criterion, field: capitalise(field) };
    }
    return { subject: stage, field: capitalise(`${stage}: ${FIELDS[third ?? ''] ?? third ?? ''}`) };
  }
  if (first === 'emailTemplates') {
    const outcome =
      second !== undefined && second in outcomes
        ? outcomes[second as keyof typeof outcomes]
        : (second ?? '');
    const subject = `${outcome.toLowerCase()} email`;
    return { subject, field: capitalise(`${subject} ${FIELDS[third ?? ''] ?? third ?? ''}`) };
  }
  const label = FIELDS[first] ?? first;
  return { subject: label, field: capitalise(label) };
}

function valueWords(path: readonly string[], value: ConfigValue, missing: string): string {
  const [first = ''] = path;
  const last = path[path.length - 1] ?? '';
  if (value === null) return missing;
  if (value === '') return 'Empty';
  if (typeof value === 'number' && first in MONEY && last === 'amountMinor') {
    return formatMoney({ amountMinor: value, currency: 'GBP' });
  }
  if (typeof value !== 'string') return String(value);
  if (last === 'opensAt' || last === 'closesAt') return formatLocal(value);
  if (last === 'status' && value in programmeStatuses) {
    return programmeStatuses[value as keyof typeof programmeStatuses];
  }
  if (last === 'latePolicy' && value in latePolicies) {
    return latePolicies[value as keyof typeof latePolicies].label;
  }
  return value;
}

/** Each change in words. A value that was not there is "Not set", and one that is gone is "Removed". */
export function describe(changes: ConfigDiff, names: Names): ChangeWords[] {
  const all = namesIn(changes, names);
  return changes.map(({ path, from, to }) => {
    const parts = path.split('.');
    return {
      ...labelOf(parts, all),
      before: valueWords(parts, from, 'Not set'),
      after: valueWords(parts, to, 'Removed'),
    };
  });
}

/** One line for a version: "Created", or "Changed budget, closing date and time and 2 more". */
export function summarise(version: ConfigVersion, names: Names): string {
  if (version.version === 1 && version.changes.every((change) => change.from === null)) {
    return 'Created';
  }
  const subjects = [...new Set(describe(version.changes, names).map(({ subject }) => subject))];
  const shown = subjects.slice(0, 3);
  const more = subjects.length - shown.length;
  return `Changed ${more > 0 ? `${shown.join(', ')} and ${String(more)} more` : list(shown)}`;
}
