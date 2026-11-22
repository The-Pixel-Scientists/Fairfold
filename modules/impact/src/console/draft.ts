// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A framework as the editor holds it, with outcomes and their indicators in
// lists, and the request it becomes, with each kept by its own id.

import type {
  Framework,
  FrameworkInput,
  IndicatorAggregation,
  IndicatorDirection,
  IndicatorUnit,
} from '../contracts/index.ts';

export interface IndicatorDraft {
  id: string;
  name: string;
  unit: IndicatorUnit;
  direction: IndicatorDirection;
  aggregation: IndicatorAggregation;
}

export interface OutcomeDraft {
  id: string;
  name: string;
  description: string;
  indicators: IndicatorDraft[];
}

export interface FrameworkDraft {
  name: string;
  description: string;
  outcomes: OutcomeDraft[];
}

/** The id of a new outcome or indicator: a uuid in lower case, as the contract takes. */
export const newId = () => crypto.randomUUID();

export const blankIndicator = (): IndicatorDraft => ({
  id: newId(),
  name: '',
  unit: 'count',
  direction: 'increase',
  aggregation: 'sum',
});

export const blankOutcome = (): OutcomeDraft => ({
  id: newId(),
  name: '',
  description: '',
  indicators: [],
});

/** A saved framework, or a blank one with its first outcome ready, as a framework needs at least one. */
export function frameworkDraft(framework?: Framework): FrameworkDraft {
  if (framework === undefined) {
    return { name: '', description: '', outcomes: [blankOutcome()] };
  }
  return {
    name: framework.name,
    description: framework.description,
    outcomes: Object.entries(framework.outcomes).map(([id, outcome]) => ({
      id,
      ...outcome,
      indicators: Object.entries(framework.indicators)
        .filter(([, indicator]) => indicator.outcomeId === id)
        .map(([indicatorId, { name, unit, direction, aggregation }]) => ({
          id: indicatorId,
          name,
          unit,
          direction,
          aggregation,
        })),
    })),
  };
}

export function frameworkBody({ name, description, outcomes }: FrameworkDraft): FrameworkInput {
  return {
    name,
    description,
    outcomes: Object.fromEntries(
      outcomes.map(({ id, name: outcome, description: about }) => [
        id,
        { name: outcome, description: about },
      ]),
    ),
    indicators: Object.fromEntries(
      outcomes.flatMap((outcome) =>
        outcome.indicators.map(({ id, ...indicator }) => [
          id,
          { outcomeId: outcome.id, ...indicator },
        ]),
      ),
    ),
  };
}

/** The ids of every control a framework's problems can name, for `useSubmit`. */
export function frameworkBoxes({ outcomes }: FrameworkDraft): string[] {
  return [
    'name',
    'description',
    'add-outcome',
    ...outcomes.flatMap((outcome) => [
      `outcome-${outcome.id}-name`,
      `outcome-${outcome.id}-description`,
      ...outcome.indicators.flatMap(({ id }) =>
        ['name', 'unit', 'direction', 'aggregation'].map((part) => `indicator-${id}-${part}`),
      ),
    ]),
  ];
}

/** The control a problem is about: `body.indicators.<id>.unit` is the unit box of that indicator. */
export function boxFor(field: string): string {
  const item = /^body\.(outcomes|indicators)\.([0-9a-f-]{36})\.(\w+)$/.exec(field);
  if (item !== null)
    return `${item[1] === 'outcomes' ? 'outcome' : 'indicator'}-${item[2] ?? ''}-${item[3] ?? ''}`;
  const top = field.replace(/^body\./, '');
  return top === 'outcomes' || top === 'indicators' ? 'add-outcome' : top;
}
