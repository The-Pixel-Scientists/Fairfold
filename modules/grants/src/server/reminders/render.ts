// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Fills a reminder from its template. A reminder names only what the
// recipient already has: their own first name, the programme and round, and
// for a draft its organisation, its closing time in UK time and the portal
// link. Never an answer, a score or anyone else's details. A template naming
// any other field, or with a stray `{{` or `}}`, is refused. Values go in as
// they are, in one pass.

import { mergeFieldsIn, type ReminderKind } from '../../contracts/index.ts';

const fieldsFor = {
  draft_closing: [
    'given_name',
    'organisation_name',
    'programme_title',
    'round_title',
    'portal_link',
    'closing_time',
  ],
  review_overdue: ['given_name', 'programme_title', 'round_title'],
} as const satisfies Record<ReminderKind, readonly string[]>;

export type ReminderValues = Readonly<Record<string, string>>;

const MERGE_FIELD = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** Throws if the template or the values break the rules above. */
export function renderReminder(
  kind: ReminderKind,
  template: { readonly subject: string; readonly body: string },
  values: ReminderValues,
): { readonly subject: string; readonly body: string } {
  const allowed: readonly string[] = fieldsFor[kind];
  const render = (text: string) => {
    if (mergeFieldsIn(text) === null) throw new Error('The template has a stray {{ or }}.');
    return text.replace(MERGE_FIELD, (_match, name: string) => {
      const value = allowed.includes(name) ? values[name] : undefined;
      if (value === undefined) throw new Error(`The ${kind} email cannot use {{${name}}}.`);
      return value;
    });
  };
  return { subject: render(template.subject), body: render(template.body) };
}
