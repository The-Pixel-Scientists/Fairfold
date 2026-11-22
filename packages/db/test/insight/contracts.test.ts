// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The checks in migration 0080 copy lists, caps and the disclosure floor
// from the insight contracts. This reads each check back from the database
// and compares it with what it copies, so neither can change alone.
// packages/db has no dependency on a module, so the contracts are loaded by
// path at run time rather than imported.

import { beforeAll, describe, expect, it } from 'vitest';

import { withClient } from '../connect.ts';

interface InsightContracts {
  readonly reportKinds: readonly string[];
  readonly publicationKinds: readonly string[];
  readonly publicationStates: readonly string[];
  readonly disclosureFloor: { readonly threshold: number; readonly minimumGroup: number };
  readonly disclosureRuleInputSchema: {
    readonly safeParse: (value: unknown) => { readonly success: boolean };
  };
}

const CONTRACTS = new URL('../../../../modules/insight/src/contracts/index.ts', import.meta.url);

let contracts: InsightContracts;
/** Each check in a schema, by name, as pg_get_constraintdef prints it. */
let checks: Map<string, string>;
let grantsChecks: Map<string, string>;

beforeAll(async () => {
  contracts = (await import(CONTRACTS.href)) as InsightContracts;
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
  checks = await read('insight');
  grantsChecks = await read('grants');
}, 60_000);

function check(name: string, from = checks): string {
  const definition = from.get(name);
  if (definition === undefined) throw new Error(`There is no check named ${name}.`);
  return definition;
}

/** The text literals in a check, in order. */
const literals = (name: string) =>
  [...check(name).matchAll(/'((?:[^']|'')*)'::text/g)].map((match) => match[1] ?? '');

/** The lowest and highest values a BETWEEN check allows. */
function bounds(name: string): [number, number] {
  const match = />= (\d+)\) AND \(\w+ <= (\d+)\)/.exec(check(name));
  if (!match) throw new Error(`Check ${name} is not a range: ${check(name)}`);
  return [Number(match[1]), Number(match[2])];
}

describe('the insight checks in migration 0080', () => {
  it('copy the report kinds, publication kinds and states', () => {
    expect(literals('report_definition_kind_check')).toEqual(contracts.reportKinds);
    expect(literals('publication_run_kind_check')).toEqual(contracts.publicationKinds);
    expect(literals('publication_run_state_check')).toEqual(contracts.publicationStates);
  });

  it('hold the disclosure floor and the caps the contract takes', () => {
    const { disclosureFloor, disclosureRuleInputSchema } = contracts;
    const [threshold, maxThreshold] = bounds('disclosure_rule_threshold_floor');
    const [minimumGroup, maxGroup] = bounds('disclosure_rule_minimum_group_floor');
    expect({ threshold, minimumGroup }).toEqual(disclosureFloor);
    const accepts = (rule: { threshold: number; minimumGroup: number }) =>
      disclosureRuleInputSchema.safeParse(rule).success;
    expect(accepts({ threshold: maxThreshold, minimumGroup: maxGroup })).toBe(true);
    expect(accepts({ threshold: maxThreshold + 1, minimumGroup: maxGroup })).toBe(false);
    expect(accepts({ threshold, minimumGroup: maxGroup + 1 })).toBe(false);
    expect(accepts({ threshold: minimumGroup + 1, minimumGroup })).toBe(false);
    expect(check('disclosure_rule_group_covers_threshold')).toBe(
      'CHECK ((minimum_group >= threshold))',
    );
  });

  it('cap a report name as the contract does, with the grants line pattern', () => {
    expect(check('report_definition_name_check')).toContain('<= 200)');
    const pattern = (definition: string) => /!~ '((?:[^']|'')*)'/.exec(definition)?.[1];
    expect(pattern(check('report_definition_name_text'))).toBe(
      pattern(check('programme_title_text', grantsChecks)),
    );
  });

  it("hold an error code to the contract's pattern", () => {
    expect(check('publication_run_error_code_check')).toContain("'^[a-z_]{1,64}$'");
  });
});
