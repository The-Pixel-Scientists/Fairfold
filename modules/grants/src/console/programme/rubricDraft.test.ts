// SPDX-License-Identifier: AGPL-3.0-or-later

import { ProblemError } from '@pixel-scientists/domain/api';
import { describe, expect, it } from 'vitest';

import { boxFor, contentOf, itemsOf, rubricBody } from './rubricDraft.ts';
import type { Item } from './rubricDraft.ts';

const NEED = 'f6a7b8c9-d0e1-4f2a-9b4c-5d6e7f8091a2';

const saved = itemsOf([
  { id: NEED, label: 'Need', guidance: 'Local evidence', weight: 5, scaleMin: 1, scaleMax: 5 },
]);

const fresh: Item = {
  key: 'new-1',
  label: 'Reach',
  guidance: '',
  weight: '4',
  scaleMin: '1',
  scaleMax: '5',
};

function problemsOf(items: readonly Item[]): { field: string; message: string }[] {
  try {
    rubricBody(items);
  } catch (error) {
    if (error instanceof ProblemError) return [...error.errors];
    throw error;
  }
  return [];
}

describe('rubricBody', () => {
  it('keeps the id of a criterion that exists and leaves the id out of one that does not', () => {
    expect(rubricBody([...saved, fresh])).toEqual({
      criteria: [
        {
          id: NEED,
          label: 'Need',
          guidance: 'Local evidence',
          weight: 5,
          scaleMin: 1,
          scaleMax: 5,
        },
        { label: 'Reach', guidance: '', weight: 4, scaleMin: 1, scaleMax: 5 },
      ],
    });
  });

  it('allows no criteria, which is a stage with no rubric', () => {
    expect(rubricBody([])).toEqual({ criteria: [] });
  });

  it('names each number that is empty or not a whole number, beside its box', () => {
    expect(problemsOf([{ ...fresh, weight: '', scaleMin: '1.5', scaleMax: 'five' }])).toEqual([
      { field: 'body.criteria.0.weight', message: 'Enter a weight from 1 to 100.' },
      { field: 'body.criteria.0.scaleMin', message: 'Enter a lowest score from 0 to 9.' },
      { field: 'body.criteria.0.scaleMax', message: 'Enter a highest score from 1 to 10.' },
    ]);
  });

  it('adds what the contract finds, criterion by criterion, in the order of the form', () => {
    expect(
      problemsOf([
        { ...fresh, label: '', weight: '101' },
        { ...fresh, key: 'new-2', scaleMin: '5', scaleMax: '5' },
        { ...fresh, key: 'new-3', label: 'Reach' },
      ]).map(({ field }) => field),
    ).toEqual(['body.criteria.0.label', 'body.criteria.0.weight', 'body.criteria.1.scaleMax']);
  });

  it('refuses a criterion listed twice', () => {
    expect(problemsOf([...saved, ...saved]).map(({ field }) => field)).toEqual([
      'body.criteria.1.id',
    ]);
  });
});

describe('the rows of a rubric', () => {
  it('know when nothing has changed', () => {
    expect(contentOf(saved)).toBe(
      contentOf(
        itemsOf([
          {
            id: NEED,
            label: 'Need',
            guidance: 'Local evidence',
            weight: 5,
            scaleMin: 1,
            scaleMax: 5,
          },
        ]),
      ),
    );
    expect(contentOf(saved)).not.toBe(contentOf(saved.map((item) => ({ ...item, weight: '6' }))));
  });

  it('name the box a path from the API belongs to', () => {
    expect(boxFor('body.criteria.2.weight')).toBe('criterion-2-weight');
    expect(boxFor('body.criteria.2.id')).toBe('criterion-2-label');
    expect(boxFor('body.criteria')).toBe('add-criterion');
  });
});
