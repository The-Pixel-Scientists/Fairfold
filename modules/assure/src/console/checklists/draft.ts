// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A checklist being edited. Items get their ids here when they are added and
// keep them in every version; the person never sees or types one. Changing
// an item's answer kind makes it a new question, so it gets a new id.

import type { ChecklistInput, ChecklistVersion } from '../../contracts/index.ts';
import { answerKindWords } from '../words.ts';

export interface DraftItem {
  id: string;
  label: string;
  help: string;
  kind: ChecklistVersion['items'][number]['kind'];
  required: boolean;
}

export interface Draft {
  name: string;
  description: string;
  items: DraftItem[];
}

export const newItem = (): DraftItem => ({
  id: crypto.randomUUID(),
  label: '',
  help: '',
  kind: 'yes_no',
  required: true,
});

export const empty = (): Draft => ({ name: '', description: '', items: [newItem()] });

export const fromVersion = ({ name, description, items }: ChecklistVersion): Draft => ({
  name,
  description,
  items: items.map((item) => ({ ...item })),
});

export const toInput = (draft: Draft): ChecklistInput => draft;

/** Moves the item at `from` to `to`, or leaves the list as it is when `to` is off either end. */
export function move<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item === undefined || to < 0 || to >= items.length) return [...items];
  next.splice(to, 0, item);
  return next;
}

const name = (item: DraftItem) => item.label.trim() || 'an item with no label';

/** What publishing changes, in words: added, changed and removed items, and the name and description. */
export function changes(base: Draft, draft: Draft): string[] {
  const words: string[] = [];
  if (base.name !== draft.name) words.push('The name changes.');
  if (base.description !== draft.description) words.push('The description changes.');
  const before = new Map(base.items.map((item) => [item.id, item]));
  const after = new Set(draft.items.map((item) => item.id));
  for (const item of draft.items) {
    const old = before.get(item.id);
    if (old === undefined) {
      words.push(`Added: ${name(item)} (${answerKindWords[item.kind]}).`);
    } else if (
      old.label !== item.label ||
      old.help !== item.help ||
      old.required !== item.required
    ) {
      words.push(`Changed: ${name(old)}.`);
    }
  }
  for (const item of base.items) if (!after.has(item.id)) words.push(`Removed: ${name(item)}.`);
  const order = (items: readonly DraftItem[], keep: ReadonlySet<string>) =>
    items.filter((item) => keep.has(item.id)).map((item) => item.id);
  const kept = new Set(base.items.map((item) => item.id));
  if (order(draft.items, kept).join() !== order(base.items, after).join()) {
    words.push('The order of the items changes.');
  }
  return words;
}

/** A change of kind gives the item a new id, so earlier answers stay with the question they answered. */
export function withKind(item: DraftItem, kind: DraftItem['kind']): DraftItem {
  return kind === item.kind ? item : { ...item, kind, id: crypto.randomUUID() };
}
