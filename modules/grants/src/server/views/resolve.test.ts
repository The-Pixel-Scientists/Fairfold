// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import type { ViewColumnId, ViewFilter, ViewSort } from '../../contracts/index.ts';
import { restrictView } from './resolve.ts';

const column = (id: ViewColumnId) => ({ kind: 'column', id }) as const;
const answer = (fieldId: string) => ({ kind: 'answer', fieldId }) as const;

const ID = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';
const view = {
  filter: { status: 'submitted', ownerId: ID, labelId: ID } satisfies ViewFilter,
  sort: { by: 'owner', direction: 'asc' } satisfies ViewSort,
  columns: [
    column('organisation'),
    column('owner'),
    column('labels'),
    column('stage'),
    answer('f_a'),
    answer('f_b'),
  ],
};
const answers = new Set(['f_a']);

describe('restrictView', () => {
  it('leaves staff everything except answers they may not see, named by id', () => {
    const { filter, sort, columns, dropped } = restrictView(
      { ...view, sort: { by: 'status', direction: 'asc' } },
      'staff',
      answers,
    );

    expect(dropped).toEqual(['answer.f_b']);
    expect(filter).toEqual(view.filter);
    expect(sort).toEqual({ by: 'status', direction: 'asc' });
    expect(columns).toHaveLength(5);
  });

  it('keeps triage data from a reviewer, falling back to the default sort', () => {
    const { filter, sort, columns, dropped } = restrictView(view, 'reviewer', answers);

    expect(dropped).toEqual([
      'owner',
      'labels',
      'answer.f_b',
      'filter.ownerId',
      'filter.labelId',
      'sort.owner',
    ]);
    expect(filter).toEqual({ status: 'submitted' });
    expect(sort).toEqual({ by: 'submittedAt', direction: 'desc' });
    expect(columns).toEqual([column('organisation'), column('stage'), answer('f_a')]);
  });

  it('also keeps the organisation from a blind reviewer, and names nothing by value', () => {
    const { columns, dropped } = restrictView(view, 'blind_reviewer', new Set());

    expect(columns).toEqual([column('stage')]);
    expect(dropped).toContain('organisation');
    expect(JSON.stringify(dropped)).not.toContain(ID);
  });

  it('does not change the view it is given', () => {
    const before = JSON.stringify(view);
    restrictView(view, 'blind_reviewer', answers);

    expect(JSON.stringify(view)).toBe(before);
  });
});
