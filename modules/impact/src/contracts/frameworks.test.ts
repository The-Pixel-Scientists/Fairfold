// SPDX-License-Identifier: AGPL-3.0-or-later

import { messageForIssue } from '@pixel-scientists/domain/platform';
import { configDiffSchemas } from '@pixel-scientists/domain/platform/settings';
import { describe, expect, it } from 'vitest';

import {
  MAX_INDICATORS,
  MAX_OUTCOMES,
  frameworkDiff,
  frameworkInputSchema,
  type FrameworkInput,
} from './frameworks.ts';
import { impactMessages } from './messages.ts';

const OUTCOME = '0b8f3a52-6c1d-4e7a-9f20-3d5c8e1b7a64';
const INDICATOR = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';

/** A lower-case uuid that differs for each `n`. */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function firstMessage(result: { error?: { issues: object[] } }): string {
  const [issue] = result.error?.issues ?? [];
  return issue === undefined ? 'no problem' : messageForIssue(issue);
}

const framework = {
  name: 'Community outcomes',
  description: '',
  outcomes: { [OUTCOME]: { name: 'Fewer older people are isolated', description: '' } },
  indicators: {
    [INDICATOR]: {
      outcomeId: OUTCOME,
      name: 'People at a lunch club each week',
      unit: 'people',
      direction: 'increase',
      aggregation: 'latest',
    },
  },
} satisfies FrameworkInput;

describe('a framework', () => {
  it('takes outcomes and indicators keyed by lower-case ids, trimmed', () => {
    const parsed = frameworkInputSchema.parse({
      ...framework,
      name: '  Community outcomes ',
      description: 'Agreed by trustees.\r\nReviewed yearly.',
    });
    expect(parsed.name).toBe('Community outcomes');
    expect(parsed.description).toBe('Agreed by trustees.\nReviewed yearly.');
    for (const bad of [
      { ...framework, outcomes: { [OUTCOME.toUpperCase()]: framework.outcomes[OUTCOME] } },
      { ...framework, outcomes: { tenantId: framework.outcomes[OUTCOME] } },
      { ...framework, owner: 'Alex Example' },
      { ...framework, outcomes: { [OUTCOME]: { name: 'x', description: '', weight: 2 } } },
    ]) {
      expect(frameworkInputSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('says what is wrong in the catalogue’s words', () => {
    const indicator = framework.indicators[INDICATOR];
    const cases: [object, string][] = [
      [{ ...framework, name: ' ' }, impactMessages.frameworkName],
      [{ ...framework, name: 'Out\u202ecomes' }, impactMessages.hiddenCharacters],
      [{ ...framework, outcomes: {} }, impactMessages.outcomes],
      [
        { ...framework, outcomes: { [OUTCOME]: { name: '', description: '' } } },
        impactMessages.outcomeName,
      ],
      [
        { ...framework, indicators: { [INDICATOR]: { ...indicator, name: '' } } },
        impactMessages.indicatorName,
      ],
      [
        { ...framework, indicators: { [INDICATOR]: { ...indicator, unit: 'miles' } } },
        impactMessages.unit,
      ],
      [
        { ...framework, indicators: { [INDICATOR]: { ...indicator, direction: 'sideways' } } },
        impactMessages.direction,
      ],
      [
        { ...framework, indicators: { [INDICATOR]: { ...indicator, aggregation: 'median' } } },
        impactMessages.aggregation,
      ],
      [
        { ...framework, indicators: { [INDICATOR]: { ...indicator, outcomeId: id(1) } } },
        impactMessages.indicatorOutcome,
      ],
    ];
    for (const [input, message] of cases) {
      expect(firstMessage(frameworkInputSchema.safeParse(input)), message).toBe(message);
    }
  });

  it('holds at most 50 outcomes and 150 indicators, and may hold no indicator yet', () => {
    const outcomes = (count: number) =>
      Object.fromEntries(
        Array.from({ length: count }, (_, n) => [
          id(n),
          { name: `Outcome ${String(n)}`, description: '' },
        ]),
      );
    const indicators = (count: number) =>
      Object.fromEntries(
        Array.from({ length: count }, (_, n) => [
          id(1000 + n),
          { ...framework.indicators[INDICATOR], outcomeId: id(0), name: `Indicator ${String(n)}` },
        ]),
      );
    const full = {
      ...framework,
      outcomes: outcomes(MAX_OUTCOMES),
      indicators: indicators(MAX_INDICATORS),
    };
    expect(frameworkInputSchema.safeParse(full).success).toBe(true);
    expect(frameworkInputSchema.safeParse({ ...framework, indicators: {} }).success).toBe(true);
    expect(
      firstMessage(
        frameworkInputSchema.safeParse({ ...full, outcomes: outcomes(MAX_OUTCOMES + 1) }),
      ),
    ).toBe(impactMessages.outcomes);
    expect(
      firstMessage(
        frameworkInputSchema.safeParse({ ...full, indicators: indicators(MAX_INDICATORS + 1) }),
      ),
    ).toBe(impactMessages.indicators);

    // The largest new framework still fits one config version.
    const diff = frameworkDiff(null, frameworkInputSchema.parse(full));
    expect(diff).toHaveLength(2 + MAX_OUTCOMES * 2 + MAX_INDICATORS * 5);
    expect(configDiffSchemas['impact.framework'].safeParse(diff).success).toBe(true);
  });
});

describe('frameworkDiff', () => {
  it('lists every value of a new framework, each a path the config diff schema takes', () => {
    const diff = frameworkDiff(null, framework);
    expect(diff.map(({ path }) => path)).toEqual([
      'name',
      'description',
      `outcomes.${OUTCOME}.name`,
      `outcomes.${OUTCOME}.description`,
      `indicators.${INDICATOR}.outcome`,
      `indicators.${INDICATOR}.name`,
      `indicators.${INDICATOR}.unit`,
      `indicators.${INDICATOR}.direction`,
      `indicators.${INDICATOR}.aggregation`,
    ]);
    expect(configDiffSchemas['impact.framework'].parse(diff)).toEqual(diff);
  });

  it('lists only what changed, with removed values going to null', () => {
    const renamed = {
      ...framework,
      outcomes: { [OUTCOME]: { name: 'Fewer people are isolated', description: '' } },
    };
    expect(frameworkDiff(framework, renamed)).toEqual([
      {
        path: `outcomes.${OUTCOME}.name`,
        from: 'Fewer older people are isolated',
        to: 'Fewer people are isolated',
      },
    ]);
    expect(frameworkDiff(framework, framework)).toEqual([]);
    const removed = frameworkDiff(framework, { ...framework, indicators: {} });
    expect(removed).toHaveLength(5);
    for (const change of removed) expect(change.to).toBeNull();
  });
});
