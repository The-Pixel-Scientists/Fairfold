// SPDX-License-Identifier: AGPL-3.0-or-later

import { fieldForIssue } from '@pixel-scientists/domain/platform';
import { describe, expect, it } from 'vitest';

import { frameworkInputSchema } from '../contracts/index.ts';
import type { Framework } from '../contracts/index.ts';
import { blankIndicator, boxFor, frameworkBody, frameworkBoxes, frameworkDraft } from './draft.ts';

const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
const reading = '33333333-3333-4333-8333-333333333333';

const saved: Framework = {
  id: '44444444-4444-4444-8444-444444444444',
  name: 'Wellbeing',
  description: '',
  outcomes: {
    [first]: { name: 'Less isolation', description: '' },
    [second]: { name: 'Better health', description: 'Health.' },
  },
  indicators: {
    [reading]: {
      outcomeId: second,
      name: 'Walks led',
      unit: 'count',
      direction: 'increase',
      aggregation: 'sum',
    },
  },
  version: 1,
  archivedAt: null,
  createdAt: '2026-11-01T09:00:00.000Z',
  updatedAt: '2026-11-01T09:00:00.000Z',
};

describe('a framework as the editor holds it', () => {
  it('starts a new one with its first outcome ready', () => {
    const draft = frameworkDraft();
    expect(draft.outcomes).toHaveLength(1);
    expect(draft.outcomes[0]?.indicators).toEqual([]);
  });

  it('groups each indicator under its outcome and turns back into the same request', () => {
    const draft = frameworkDraft(saved);
    expect(draft.outcomes.find(({ id }) => id === second)?.indicators.map(({ id }) => id)).toEqual([
      reading,
    ]);
    const body = frameworkBody(draft);
    expect(body.indicators[reading]).toEqual({
      outcomeId: second,
      name: 'Walks led',
      unit: 'count',
      direction: 'increase',
      aggregation: 'sum',
    });
    expect(frameworkInputSchema.safeParse(body).success).toBe(true);
  });

  it('makes lower-case ids the contract takes', () => {
    const { id } = blankIndicator();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

describe('where a problem is shown', () => {
  it('names the box of the outcome or indicator a problem is about, whatever the contract reports', () => {
    const draft = frameworkDraft(saved);
    const body = frameworkBody(draft);
    body.name = '';
    body.outcomes[first] = { name: '', description: '' };
    body.indicators[reading] = {
      outcomeId: second,
      name: '',
      unit: 'count',
      direction: 'increase',
      aggregation: 'sum',
    };
    const issues = frameworkInputSchema.safeParse(body).error?.issues ?? [];
    const boxes = issues.map((issue) => boxFor(fieldForIssue('body', issue)));
    expect(boxes.sort()).toEqual(
      ['name', `indicator-${reading}-name`, `outcome-${first}-name`].sort(),
    );
    for (const box of boxes) expect(frameworkBoxes(draft)).toContain(box);
  });

  it('sends problems with the whole list to the button that adds an outcome', () => {
    expect(boxFor('body.outcomes')).toBe('add-outcome');
    expect(boxFor('body.indicators')).toBe('add-outcome');
    expect(boxFor('body.description')).toBe('description');
  });
});
