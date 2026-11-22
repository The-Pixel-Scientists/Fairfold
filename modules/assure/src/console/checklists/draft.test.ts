// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { changes, empty, move, newItem, withKind } from './draft.ts';
import type { Draft } from './draft.ts';

const item = (label: string, id: string) => ({ ...newItem(), id, label });

const base: Draft = {
  name: 'Governance checks',
  description: '',
  items: [item('Has a constitution', 'a'), item('Has a safeguarding policy', 'b')],
};

describe('what publishing changes', () => {
  it('says nothing when nothing changed', () => {
    expect(changes(base, structuredClone(base))).toEqual([]);
  });

  it('lists added, changed and removed items and a reorder in words', () => {
    const [first, second] = base.items;
    const draft: Draft = {
      ...base,
      items: [
        { ...second!, label: 'Has a safeguarding policy in date' },
        item('Has insurance', 'c'),
        first!,
      ],
    };
    expect(changes(base, draft)).toEqual([
      'Changed: Has a safeguarding policy.',
      'Added: Has insurance (Yes or no).',
      'The order of the items changes.',
    ]);
    expect(changes(base, { ...base, items: [first!] })).toEqual([
      'Removed: Has a safeguarding policy.',
    ]);
  });

  it('treats a new answer kind as a new question', () => {
    const first = base.items[0]!;
    const changed = withKind(first, 'date');
    expect(changed.id).not.toBe(first.id);
    expect(withKind(first, first.kind)).toBe(first);
    expect(changes(base, { ...base, items: [changed, base.items[1]!] })).toEqual([
      'Added: Has a constitution (Date).',
      'Removed: Has a constitution.',
    ]);
  });
});

describe('moving items', () => {
  it('moves one place and stays put at the ends', () => {
    expect(move([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
    expect(move([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
    expect(move([1, 2, 3], 2, 3)).toEqual([1, 2, 3]);
  });

  it('starts a new checklist with one blank required item and a fresh id each time', () => {
    const [one] = empty().items;
    expect(one).toMatchObject({ label: '', kind: 'yes_no', required: true });
    expect(newItem().id).not.toBe(newItem().id);
  });
});
