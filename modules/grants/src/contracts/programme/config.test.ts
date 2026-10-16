// SPDX-License-Identifier: AGPL-3.0-or-later

import { moduleIds } from '@pixel-scientists/domain/platform';
import { configEntityTypes } from '@pixel-scientists/domain/platform/settings';
import { describe, expect, it } from 'vitest';

import {
  configDiff,
  configDiffSchema,
  configHistorySchema,
  configVersionDiffSchema,
  grantsConfigEntityTypes,
  MAX_CONFIG_CHANGES,
} from './config.ts';
import { MAX_CRITERIA, MAX_STAGES } from './inputs.ts';

const stageId = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';
const criterionId = '6d2e3f4a-5b6c-4d7e-8f90-b1c2d3e4f5a6';
const membershipId = '7e3f4a5b-6c7d-4e8f-90a1-c2d3e4f5a6b7';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

/** A round's stages at the input limits, every criterion with all its values. */
function fullStages(first: number) {
  return Object.fromEntries(
    Array.from({ length: MAX_STAGES }, (_, s) => [
      id(first + s * 100),
      {
        name: `Stage ${String(s + 1)}`,
        position: s + 1,
        criteria: Object.fromEntries(
          Array.from({ length: MAX_CRITERIA }, (_, c) => [
            id(first + s * 100 + c + 1),
            {
              label: `Criterion ${String(c + 1)}`,
              guidance: 'How well the plan meets the need.',
              weight: 5,
              scaleMin: 1,
              scaleMax: 5,
              position: c + 1,
            },
          ]),
        ),
      },
    ]),
  );
}

const round = {
  title: 'Spring 2027',
  closesAt: '2027-03-03T17:00',
  budget: { amountMinor: 25_000_000, currency: 'GBP' },
  stages: {
    [stageId]: {
      name: 'Review',
      position: 2,
      criteria: { [criterionId]: { label: 'Need', weight: 3 } },
    },
  },
};

describe('configuration entity types', () => {
  it('are named <module>.<entity>, as app.config_version checks, apart from the platform ones', () => {
    for (const type of grantsConfigEntityTypes) {
      expect(type).toMatch(/^[a-z]+\.[a-z_]+$/);
      expect(type.split('.')[0]).toBe('grants');
      expect(configEntityTypes).not.toContain(type);
    }
    expect(moduleIds).toContain('grants');
  });
});

describe('configDiff', () => {
  it('lists each changed value by its path, with its old and new values', () => {
    const after = {
      ...round,
      title: 'Spring 2027 (extended)',
      budget: { amountMinor: 30_000_000, currency: 'GBP' },
      stages: {
        [stageId]: {
          ...round.stages[stageId],
          criteria: { [criterionId]: { label: 'Need', weight: 4 } },
        },
      },
    };
    expect(configDiff(round, after)).toEqual([
      { path: 'title', from: 'Spring 2027', to: 'Spring 2027 (extended)' },
      { path: 'budget.amountMinor', from: 25_000_000, to: 30_000_000 },
      { path: `stages.${stageId}.criteria.${criterionId}.weight`, from: 3, to: 4 },
    ]);
    expect(configDiff(round, round)).toEqual([]);
  });

  it('gives an added value from null and a removed one to null', () => {
    expect(configDiff(null, { title: 'Spring 2027' })).toEqual([
      { path: 'title', from: null, to: 'Spring 2027' },
    ]);
    const removed = configDiff(round, { ...round, stages: {} });
    expect(removed).toEqual([
      { path: `stages.${stageId}.name`, from: 'Review', to: null },
      { path: `stages.${stageId}.position`, from: 2, to: null },
      { path: `stages.${stageId}.criteria.${criterionId}.label`, from: 'Need', to: null },
      { path: `stages.${stageId}.criteria.${criterionId}.weight`, from: 3, to: null },
    ]);
    expect(configDiffSchema.parse(removed)).toEqual(removed);
  });

  it('refuses list positions and other keys that are not a field name or an id', () => {
    const list = { stages: [{ name: 'Intake' }] } as unknown as Parameters<typeof configDiff>[1];
    expect(() => configDiff(null, list)).toThrow('stages.0.name is not a configuration path.');
    expect(() => configDiff(null, { 'tenant id': 'x' })).toThrow();
    expect(() => configDiff(null, { stages: { 'Review stage': { name: 'x' } } })).toThrow();
  });
});

describe('configuration diffs', () => {
  it('refuse an empty diff, a bad path, an object value and extra keys', () => {
    for (const diff of [
      [],
      [{ path: 'stages.0.name', from: null, to: 'Intake' }],
      [{ path: 'Title', from: 'a', to: 'b' }],
      [{ path: 'budget', from: null, to: { amountMinor: 1, currency: 'GBP' } }],
      [{ path: 'title', from: 'a', to: 'b', by: membershipId }],
    ]) {
      expect(configDiffSchema.safeParse(diff).success, JSON.stringify(diff)).toBe(false);
    }
  });

  it('are stored as a JSON object, which app.config_version requires', () => {
    const changes = configDiff(null, { title: 'Spring 2027' });
    const stored = JSON.parse(JSON.stringify({ changes })) as unknown;
    expect(configVersionDiffSchema.parse(stored)).toEqual({ changes });
    expect(typeof stored === 'object' && stored !== null && !Array.isArray(stored)).toBe(true);
    for (const diff of [changes, { changes: [] }, { changes, by: membershipId }]) {
      expect(configVersionDiffSchema.safeParse(diff).success, JSON.stringify(diff)).toBe(false);
    }
  });

  it('hold any change the inputs allow, up to every value of both versions', () => {
    const before = { ...round, stages: fullStages(1_000) };
    const oneNewStage = { ...round, stages: { [id(9_999)]: { name: 'Intake', position: 1 } } };
    const allReplaced = { ...round, stages: fullStages(5_000) };
    for (const after of [oneNewStage, allReplaced]) {
      const changes = configDiff(before, after);
      expect(changes.length).toBeGreaterThan(1_000);
      expect(changes.length).toBeLessThanOrEqual(MAX_CONFIG_CHANGES);
      expect(configVersionDiffSchema.safeParse({ changes }).success).toBe(true);
      const version = {
        version: 2,
        createdAt: '2027-01-28T10:15:00.000Z',
        author: { membershipId, name: null },
        changes,
      };
      expect(configHistorySchema.safeParse({ versions: [version] }).success).toBe(true);
    }
    const tooMany = Array.from({ length: MAX_CONFIG_CHANGES + 1 }, (_, n) => ({
      path: `title${'a'.repeat(n % 10)}`,
      from: n,
      to: n + 1,
    }));
    expect(configDiffSchema.safeParse(tooMany).success).toBe(false);
  });

  it('come back newest first, with the author and the stored changes', () => {
    const stored = { changes: [{ path: 'title', from: 'Spring', to: 'Spring 2027' }] };
    const history = {
      versions: [
        {
          version: 2,
          createdAt: '2027-01-28T10:15:00.000Z',
          author: { membershipId, name: 'Ada Morgan' },
          ...configVersionDiffSchema.parse(stored),
        },
      ],
    };
    expect(configHistorySchema.parse(history)).toEqual(history);
  });
});
