// SPDX-License-Identifier: AGPL-3.0-or-later
//
// How a checklist's items carry across versions (rule 7, rule 10): ids the
// server settles, the diff the configuration version holds, and when an
// application's answers are complete. The diff must pass the platform's own
// schema for an `assure.checklist` change.

import { randomUUID } from 'node:crypto';

import { configDiffSchemas } from '@pixel-scientists/domain/platform/settings';
import { describe, expect, it } from 'vitest';

import { checklistDiff, isComplete, settleIds, type Item } from './items.ts';

const item = (label: string, kind: Item['kind'] = 'yes_no', required = true): Item => ({
  id: randomUUID(),
  label,
  help: '',
  kind,
  required,
});

describe('settleIds', () => {
  it('keeps the id of an item whose kind is unchanged', () => {
    const one = item('One');
    const two = item('Two', 'date');
    const settled = settleIds([one, two], [{ ...one, label: 'One, reworded' }, two]);
    expect(settled.map(({ id }) => id)).toEqual([one.id, two.id]);
  });

  it('gives a new id to a changed kind, and to any id the previous version lacks', () => {
    const one = item('One');
    const invented = item('Invented');
    const [changed, added] = settleIds([one], [{ ...one, kind: 'date' }, invented]);
    expect(changed?.id).not.toBe(one.id);
    expect(added?.id).not.toBe(invented.id);
    expect(settleIds([], [invented])[0]?.id).not.toBe(invented.id);
  });
});

describe('checklistDiff', () => {
  const content = (items: Item[]) => ({ name: 'Checks', description: '', items });

  it('lists a new checklist by path, and passes the platform’s diff schema', () => {
    const policy = item('Policy seen');
    const diff = checklistDiff(null, content([policy]));
    expect(diff).toContainEqual({
      path: `items.${policy.id}.label`,
      from: null,
      to: 'Policy seen',
    });
    expect(diff).toContainEqual({ path: `items.${policy.id}.position`, from: null, to: 0 });
    expect(configDiffSchemas['assure.checklist'].safeParse(diff).success).toBe(true);
  });

  it('lists only what changed, and an unchanged checklist has no diff', () => {
    const one = item('One');
    const two = item('Two');
    expect(checklistDiff(content([one, two]), content([one, two]))).toEqual([]);
    const reordered = checklistDiff(content([one, two]), content([two, one]));
    expect(reordered.map(({ path }) => path).sort()).toEqual(
      [`items.${one.id}.position`, `items.${two.id}.position`].sort(),
    );
    const removed = checklistDiff(content([one, two]), content([one]));
    expect(removed).toContainEqual({ path: `items.${two.id}.label`, from: 'Two', to: null });
  });
});

describe('isComplete', () => {
  it('needs every required item answered and no optional one', () => {
    const required = item('One');
    const optional = item('Two', 'date', false);
    expect(isComplete([required, optional], new Set())).toBe(false);
    expect(isComplete([required, optional], new Set([required.id]))).toBe(true);
  });
});
