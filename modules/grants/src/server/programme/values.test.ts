// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { configDiff, configDiffSchema, type Stage } from '../../contracts/index.ts';
import {
  columnChanges,
  programmeColumns,
  roundColumns,
  roundValues,
  stageFields,
  stageValues,
} from './values.ts';

const STAGE = '7f0c1f0e-6a9b-4c41-8d57-0d3a5a1c2b11';
const CRITERION = '1b2c3d4e-5f60-4718-9a2b-3c4d5e6f7a8b';

const round = {
  title: 'Autumn 2026',
  opensAt: '2026-10-20T09:00',
  closesAt: '2026-11-03T17:00',
  timeZone: 'Europe/London',
  budget: { amountMinor: 5_000_000, currency: 'GBP' as const },
  awardMinimum: { amountMinor: 100_000, currency: 'GBP' as const },
  awardMaximum: { amountMinor: 2_500_000, currency: 'GBP' as const },
  latePolicy: 'refuse' as const,
};

const stage: Stage = {
  id: STAGE,
  name: 'Review',
  position: 2,
  criteria: [{ id: CRITERION, label: 'Need', guidance: '', weight: 2, scaleMin: 1, scaleMax: 5 }],
};

describe('the values a round records', () => {
  it('give a diff the contract accepts, with money as its amount and the zone beside the times', () => {
    const diff = configDiff(null, { ...roundValues(round), ...stageValues([stage]) });

    expect(configDiffSchema.safeParse(diff).success).toBe(true);
    expect(diff).toContainEqual({ path: 'budget.amountMinor', from: null, to: 5_000_000 });
    expect(diff).toContainEqual({ path: 'timeZone', from: null, to: 'Europe/London' });
    expect(diff).toContainEqual({ path: `stages.${STAGE}.position`, from: null, to: 2 });
    expect(diff).toContainEqual({
      path: `stages.${STAGE}.criteria.${CRITERION}.scaleMax`,
      from: null,
      to: 5,
    });
  });

  it('give no change for a round saved as it was', () => {
    expect(configDiff(roundValues(round), roundValues({ ...round }))).toEqual([]);
    expect(configDiff(stageValues([stage]), stageValues([{ ...stage }]))).toEqual([]);
  });

  it('record a criterion’s place in its list, so moving one is a change', () => {
    const first = stage.criteria[0];
    if (first === undefined) throw new Error('The stage has a criterion.');
    const second = { ...first, id: '2b2c3d4e-5f60-4718-9a2b-3c4d5e6f7a8b' };

    const diff = configDiff(
      stageValues([{ ...stage, criteria: [first, second] }]),
      stageValues([{ ...stage, criteria: [second, first] }]),
    );

    expect(diff.map((change) => change.path)).toEqual([
      `stages.${STAGE}.criteria.${first.id}.position`,
      `stages.${STAGE}.criteria.${second.id}.position`,
    ]);
  });
});

describe('the audit changes of a diff', () => {
  it('map a round’s paths to its columns, with old and new values, and leave out any other path', () => {
    const diff = configDiff(roundValues(round), {
      ...roundValues({
        ...round,
        opensAt: '2026-10-21T09:00',
        awardMaximum: { amountMinor: 3_000_000, currency: 'GBP' },
      }),
      unrelated: 'x',
    });

    expect(columnChanges('grants.round', roundColumns, diff)).toEqual({
      'grants.round.opens_at': { before: '2026-10-20T09:00', after: '2026-10-21T09:00' },
      'grants.round.award_max_minor': { before: 2_500_000, after: 3_000_000 },
    });
  });

  it('map a programme’s paths to its columns', () => {
    const diff = configDiff({ title: 'A', status: 'draft' }, { title: 'B', status: 'draft' });

    expect(columnChanges('grants.programme', programmeColumns, diff)).toEqual({
      'grants.programme.title': { before: 'A', after: 'B' },
    });
  });

  it('name the stage and criterion columns a diff touched, with no values', () => {
    const diff = configDiff(null, stageValues([stage]));

    expect(stageFields(diff)).toEqual({
      'grants.stage.name': {},
      'grants.stage.position': {},
      'grants.rubric_criterion.label': {},
      'grants.rubric_criterion.guidance': {},
      'grants.rubric_criterion.weight': {},
      'grants.rubric_criterion.scale_min': {},
      'grants.rubric_criterion.scale_max': {},
      'grants.rubric_criterion.position': {},
    });
  });
});
