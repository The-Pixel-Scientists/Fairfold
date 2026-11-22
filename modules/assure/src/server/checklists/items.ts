// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A checklist's items across versions (rule 7, rule 10). The server gives
// every new item its id; an item keeps its id while its answer kind stays
// the same, and a changed kind makes a new item, so an answer given under
// the old kind never reads as the new one. The diff lists configuration
// only, by path, never an answer.

import type { ChecklistInput } from '../../contracts/index.ts';
import type { ChecklistChange } from './context.ts';

export type Item = ChecklistInput['items'][number];

/** A version's content, as written and as read. */
export interface Content {
  readonly name: string;
  readonly description: string;
  readonly items: readonly Item[];
}

/**
 * The submitted items with their ids settled: a submitted id is kept only
 * when `previous` has an item with that id and kind, and every other item
 * gets a new id. A client's id for a new item is never used.
 */
export function settleIds(previous: readonly Item[], submitted: readonly Item[]): Item[] {
  const kinds = new Map(previous.map(({ id, kind }) => [id, kind]));
  return submitted.map((item) => ({
    ...item,
    id: kinds.get(item.id) === item.kind ? item.id : globalThis.crypto.randomUUID(),
  }));
}

function paths(content: Content | null): Map<string, ChecklistChange['to']> {
  const values = new Map<string, ChecklistChange['to']>();
  if (content === null) return values;
  values.set('name', content.name).set('description', content.description);
  content.items.forEach(({ id, label, help, kind, required }, position) => {
    values
      .set(`items.${id}.label`, label)
      .set(`items.${id}.help`, help)
      .set(`items.${id}.kind`, kind)
      .set(`items.${id}.required`, required)
      .set(`items.${id}.position`, position);
  });
  return values;
}

/** What changed from `before` (null for a new checklist) to `after`, by path. */
export function checklistDiff(before: Content | null, after: Content): ChecklistChange[] {
  const from = paths(before);
  const to = paths(after);
  return [...new Set([...from.keys(), ...to.keys()])]
    .map((path) => ({ path, from: from.get(path) ?? null, to: to.get(path) ?? null }))
    .filter((change) => change.from !== change.to);
}

/** Whether every required item is among the answered ones. */
export const isComplete = (items: readonly Item[], answered: ReadonlySet<string>): boolean =>
  items.every(({ id, required }) => !required || answered.has(id));
