// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The checks in migration 0067 copy lists and caps from the impact
// contracts. This reads each check back from the database and compares it
// with what it copies, so neither can change alone, and runs the figure
// trigger against the contracts' own rule for a figure and its unit.
// packages/db has no dependency on a module, so the contracts are loaded by
// path at run time rather than imported.

import { beforeAll, describe, expect, it } from 'vitest';

import { withClient } from '../connect.ts';
import { asMigratorIn, createTestTenant, type TestTenant } from '../tenants.ts';
import { addImpactParts, insertOutcome, resultRow, type ImpactParts } from './fixtures.ts';

interface ImpactContracts {
  readonly indicatorUnits: readonly string[];
  readonly indicatorDirections: readonly string[];
  readonly indicatorAggregations: readonly string[];
  readonly resultSources: readonly string[];
  readonly MAX_OUTCOMES: number;
  readonly MAX_INDICATORS: number;
  readonly MAX_FIGURE: number;
  readonly figureProblem: (unit: string, value: number) => unknown;
}

const CONTRACTS = new URL('../../../../modules/impact/src/contracts/index.ts', import.meta.url);

let impact: ImpactContracts;
/** Each check in a schema, by name, as pg_get_constraintdef prints it. */
let checks: Map<string, string>;
let grantsText: Map<string, string>;

beforeAll(async () => {
  impact = (await import(CONTRACTS.href)) as ImpactContracts;
  const read = (schema: string) =>
    withClient('app_api', async (client) => {
      const { rows } = await client.query<{ name: string; definition: string }>(
        `SELECT o.conname AS name, pg_catalog.pg_get_constraintdef(o.oid) AS definition
           FROM pg_catalog.pg_constraint o
          WHERE o.connamespace = $1::regnamespace AND o.contype = 'c'`,
        [schema],
      );
      return new Map(rows.map((row) => [row.name, row.definition]));
    });
  checks = await read('impact');
  grantsText = await read('grants');
}, 60_000);

function check(name: string, from = checks): string {
  const definition = from.get(name);
  if (definition === undefined) throw new Error(`There is no check named ${name}.`);
  return definition;
}

/** The text literals in a check, in order. */
const literals = (name: string) =>
  [...check(name).matchAll(/'((?:[^']|'')*)'::text/g)].map((match) => match[1] ?? '');

describe('the impact checks in migration 0067', () => {
  it('copy the units, directions, aggregations and sources', () => {
    expect(literals('indicator_unit_check')).toEqual(impact.indicatorUnits);
    expect(literals('indicator_direction_check')).toEqual(impact.indicatorDirections);
    expect(literals('indicator_aggregation_check')).toEqual(impact.indicatorAggregations);
    expect(literals('result_source_check')).toEqual(impact.resultSources);
  });

  it('copy the caps on outcomes, indicators and figures', () => {
    expect(check('outcome_position_check')).toContain(`<= ${String(impact.MAX_OUTCOMES - 1)})`);
    expect(check('indicator_position_check')).toContain(`<= ${String(impact.MAX_INDICATORS - 1)})`);
    for (const name of ['target_baseline_check', 'target_target_check', 'result_value_check']) {
      expect(check(name), name).toContain(`<= ('${String(impact.MAX_FIGURE)}'::bigint)::numeric`);
    }
  });

  it('copy the caps on names, descriptions, notes and captions', () => {
    const caps: Readonly<Record<string, number>> = {
      framework_name_check: 200,
      framework_description_check: 2000,
      outcome_name_check: 200,
      outcome_description_check: 2000,
      indicator_name_check: 200,
      result_note_check: 2000,
      result_evidence_caption_check: 200,
      learning_note_body_check: 5000,
    };
    for (const [name, cap] of Object.entries(caps)) {
      expect(check(name), name).toContain(`<= ${String(cap)})`);
    }
  });

  it('use the grants schema text patterns for lines and paragraphs', () => {
    const pattern = (definition: string) => /!~ '((?:[^']|'')*)'/.exec(definition)?.[1];
    const line = pattern(check('programme_title_text', grantsText));
    const text = pattern(check('programme_description_text', grantsText));
    for (const name of [
      'framework_name_text',
      'outcome_name_text',
      'indicator_name_text',
      'result_evidence_caption_text',
    ]) {
      expect(pattern(check(name)), name).toBe(line);
    }
    for (const name of [
      'framework_description_text',
      'outcome_description_text',
      'result_note_text',
      'learning_note_body_text',
    ]) {
      expect(pattern(check(name)), name).toBe(text);
    }
  });
});

describe('a figure and its unit', { timeout: 60_000 }, () => {
  let tenant: TestTenant;
  const parts = new Map<string, ImpactParts>();

  beforeAll(async () => {
    tenant = await createTestTenant();
    await asMigratorIn(tenant.id, async (client) => {
      for (const unit of impact.indicatorUnits) {
        parts.set(unit, await addImpactParts(client, tenant, unit));
      }
    });
  }, 60_000);

  it('are refused by the database exactly when the contracts refuse them', async () => {
    for (const unit of impact.indicatorUnits) {
      for (const value of [0, 12, 12.5, 100, 100.01, 2500]) {
        const row = resultRow(tenant, parts.get(unit) as ImpactParts, { value });
        expect(
          await insertOutcome('app_api', tenant, 'impact.result', row),
          `${unit} ${String(value)}`,
        ).toBe(impact.figureProblem(unit, value) ? '23514' : 'ok');
      }
    }
  });
});
