// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Outcomes frameworks: versioned configuration (rule 10) in
// `impact.framework`. A framework lists the outcomes a funder works towards
// and the indicators that show progress on each. Each change records an
// `impact.framework` config version whose diff lists each changed value by
// path: `name`, `description`, `outcomes.<id>.name`,
// `outcomes.<id>.description`, and `indicators.<id>.outcome`, `.name`,
// `.unit`, `.direction` or `.aggregation`.
//
// Outcomes and indicators are keyed by ids the console makes, so a rename
// keeps the results and targets recorded against an indicator. An
// indicator's unit is fixed once it has results or targets, and an indicator
// that has them cannot be removed; the server refuses both.

import { idSchema } from '@pixel-scientists/domain';
import { z } from 'zod';

import { impactMessages, says } from './messages.ts';
import { choice, itemIdSchema, line, paragraphs, timestampSchema } from './schemas.ts';

/**
 * What an indicator's figures measure. `count`, `people` and `money` are
 * whole numbers, money in minor units of GBP (ADR 0041); `percentage` runs
 * from 0 to 100; `hours` and `number` take up to 2 decimal places.
 */
export const indicatorUnits = [
  'count',
  'people',
  'percentage',
  'money',
  'hours',
  'number',
] as const;

export type IndicatorUnit = (typeof indicatorUnits)[number];

/** Whether a higher or a lower figure is better. */
export const indicatorDirections = ['increase', 'decrease'] as const;

export type IndicatorDirection = (typeof indicatorDirections)[number];

/** How results for several periods or programmes combine into one figure. */
export const indicatorAggregations = ['sum', 'average', 'latest'] as const;

export type IndicatorAggregation = (typeof indicatorAggregations)[number];

export const MAX_OUTCOMES = 50;
/** With MAX_OUTCOMES, few enough that a new framework's diff fits a config version's 1,000 changes. */
export const MAX_INDICATORS = 150;

const outcomeSchema = z.strictObject({
  name: z.string(),
  description: z.string(),
});

const indicatorSchema = z.strictObject({
  outcomeId: itemIdSchema,
  name: z.string(),
  unit: z.enum(indicatorUnits),
  direction: z.enum(indicatorDirections),
  aggregation: z.enum(indicatorAggregations),
});

const size = (min: number, max: number) => (record: object) => {
  const count = Object.keys(record).length;
  return count >= min && count <= max;
};

/** Making or changing a framework. */
export const frameworkInputSchema = z
  .strictObject({
    name: line(200, impactMessages.frameworkName),
    description: paragraphs(2000),
    outcomes: z
      .record(
        itemIdSchema,
        outcomeSchema.extend({
          name: line(200, impactMessages.outcomeName),
          description: paragraphs(2000),
        }),
      )
      .refine(size(1, MAX_OUTCOMES), says(impactMessages.outcomes)),
    indicators: z
      .record(
        itemIdSchema,
        indicatorSchema.extend({
          name: line(200, impactMessages.indicatorName),
          unit: choice(indicatorUnits, impactMessages.unit),
          direction: choice(indicatorDirections, impactMessages.direction),
          aggregation: choice(indicatorAggregations, impactMessages.aggregation),
        }),
      )
      .refine(size(0, MAX_INDICATORS), says(impactMessages.indicators)),
  })
  .refine(
    ({ outcomes, indicators }) =>
      Object.values(indicators).every(({ outcomeId }) => Object.hasOwn(outcomes, outcomeId)),
    { ...says(impactMessages.indicatorOutcome), path: ['indicators'] },
  );

export type FrameworkInput = z.infer<typeof frameworkInputSchema>;

export const frameworkSchema = z.object({
  id: idSchema,
  name: z.string(),
  description: z.string(),
  outcomes: z.record(itemIdSchema, outcomeSchema),
  indicators: z.record(itemIdSchema, indicatorSchema),
  version: z.int().min(1),
  archivedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export type Framework = z.infer<typeof frameworkSchema>;

/** By name, archived frameworks last. */
export const frameworkListSchema = z.object({
  frameworks: z.array(
    z.object({
      id: idSchema,
      name: z.string(),
      description: z.string(),
      outcomeCount: z.int().min(0),
      indicatorCount: z.int().min(0),
      version: z.int().min(1),
      archivedAt: timestampSchema.nullable(),
      updatedAt: timestampSchema,
    }),
  ),
});

export type FrameworkList = z.infer<typeof frameworkListSchema>;

/** One changed value, as the `impact.framework` config diff schema records it. */
export interface FrameworkChange {
  readonly path: string;
  readonly from: string | null;
  readonly to: string | null;
}

function paths(framework: FrameworkInput | null): Map<string, string | null> {
  const values = new Map<string, string | null>();
  if (framework === null) return values;
  values.set('name', framework.name).set('description', framework.description);
  for (const [id, outcome] of Object.entries(framework.outcomes)) {
    values.set(`outcomes.${id}.name`, outcome.name);
    values.set(`outcomes.${id}.description`, outcome.description);
  }
  for (const [id, indicator] of Object.entries(framework.indicators)) {
    values
      .set(`indicators.${id}.outcome`, indicator.outcomeId)
      .set(`indicators.${id}.name`, indicator.name)
      .set(`indicators.${id}.unit`, indicator.unit)
      .set(`indicators.${id}.direction`, indicator.direction)
      .set(`indicators.${id}.aggregation`, indicator.aggregation);
  }
  return values;
}

/**
 * The changes from one version of a framework to the next, `before` being
 * null for a new one; empty when nothing recorded changed.
 */
export function frameworkDiff(
  before: FrameworkInput | null,
  after: FrameworkInput,
): FrameworkChange[] {
  const from = paths(before);
  const to = paths(after);
  return [...new Set([...from.keys(), ...to.keys()])]
    .map((path) => ({ path, from: from.get(path) ?? null, to: to.get(path) ?? null }))
    .filter((change) => change.from !== change.to);
}
