// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The log's facts in the content style's words: dates as 14 October 2026,
// 2:05pm, codes as plain names, and values as text.

import { modules } from '@pixel-scientists/domain/platform';
import type { AuditEvent } from '@pixel-scientists/domain/platform/audit-log';

const sentence = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** Words for a code's part: `form_version` is "Form version". */
const spaced = (code: string): string => sentence(code.replaceAll('_', ' '));

function formatterFor(timeZone: string | undefined): Intl.DateTimeFormat {
  const options: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  };
  try {
    return new Intl.DateTimeFormat('en-GB', { ...options, ...(timeZone && { timeZone }) });
  } catch {
    return new Intl.DateTimeFormat('en-GB', options);
  }
}

/** `2026-10-14T13:05:00.000Z` as "14 October 2026, 2:05pm", in the funder's time zone, or the browser's without one. */
export function formatWhen(iso: string, timeZone?: string): string {
  const part = new Map(
    formatterFor(timeZone)
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  const period = (part.get('dayPeriod') ?? '').toLowerCase();
  return `${part.get('day') ?? ''} ${part.get('month') ?? ''} ${part.get('year') ?? ''}, ${part.get('hour') ?? ''}:${part.get('minute') ?? ''}${period}`;
}

/** Who acted. Only staff are named, and an applicant is never. */
export function actorName(actor: AuditEvent['actor']): string {
  switch (actor.kind) {
    case 'staff':
      return actor.name ?? 'Team member';
    case 'applicant':
      return 'Applicant';
    case 'system':
      return 'System';
    case 'operator':
      return 'Platform operator';
  }
}

const isModule = (name: string): name is keyof typeof modules => Object.hasOwn(modules, name);

/** `grants` as "Grants". An unknown module is shown as its code. */
export function moduleLabel(id: string): string {
  return isModule(id) ? modules[id].label : id;
}

/** `grants.form_version` as "Form version". */
export function entityLabel(entityType: string): string {
  return spaced(entityType.split('.')[1] ?? entityType);
}

/** The module an entity type belongs to: `grants.decision` is "Grants". */
export const entityModule = (entityType: string): string =>
  moduleLabel(entityType.split('.')[0] ?? '');

/** The column a field id names, as words: `party.person.family_name` is "Family name". Form fields have no name to show. */
export function fieldLabel(fieldId: string): string {
  const name = fieldId.split('.')[2];
  return name === undefined ? 'Form answer' : spaced(name);
}

type Kept = Exclude<AuditEvent['changes'][string]['before'], undefined>;

/** A kept value as text. */
export function valueText(value: Kept): string {
  if (Array.isArray(value)) return value.length === 0 ? 'None' : value.map(valueText).join(', ');
  if (value === null) return 'Empty';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

/** How many fields an event changed, for its row. */
export function changeCount(event: AuditEvent): string {
  const count = Object.keys(event.changes).length;
  return count === 0 ? 'None' : `${String(count)} ${count === 1 ? 'field' : 'fields'}`;
}
