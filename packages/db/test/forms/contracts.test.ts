// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The checks in migration 0079 copy lists and caps from the forms
// contracts. This reads each check back from the database and compares it
// with what it copies, so neither can change alone. packages/db has no
// dependency on a module, so the contracts are loaded by path at run time
// rather than imported.

import { beforeAll, describe, expect, it } from 'vitest';

import { withClient } from '../connect.ts';

interface FormsContracts {
  readonly respondentOptions: readonly string[];
  readonly responseRoutes: readonly string[];
  readonly formStatuses: readonly string[];
  readonly spamReasons: readonly string[];
  readonly RETENTION_MONTHS: { readonly min: number; readonly max: number };
  readonly DEFAULT_RETENTION_MONTHS: number;
  readonly ANONYMOUS_RETENTION_MONTHS: number;
  readonly FORM_DEFINITION_MAX_BYTES: number;
  readonly PUBLIC_SUBMIT_MAX_BYTES: number;
}

const CONTRACTS = new URL('../../../../modules/forms/src/contracts/index.ts', import.meta.url);

let forms: FormsContracts;
/** Each check in the forms schema, by name, as pg_get_constraintdef prints it. */
let checks: Map<string, string>;
let retentionDefault: string | null;

beforeAll(async () => {
  forms = (await import(CONTRACTS.href)) as FormsContracts;
  await withClient('app_api', async (client) => {
    const { rows } = await client.query<{ name: string; definition: string }>(
      `SELECT o.conname AS name, pg_catalog.pg_get_constraintdef(o.oid) AS definition
         FROM pg_catalog.pg_constraint o
        WHERE o.connamespace = 'forms'::regnamespace AND o.contype = 'c'`,
    );
    checks = new Map(rows.map((row) => [row.name, row.definition]));
    const { rows: defaults } = await client.query<{ value: string | null }>(
      `SELECT pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS value
         FROM pg_catalog.pg_attrdef d
         JOIN pg_catalog.pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
        WHERE d.adrelid = 'forms.form'::regclass AND a.attname = 'retention_months'`,
    );
    retentionDefault = defaults[0]?.value ?? null;
  });
}, 60_000);

function check(name: string): string {
  const definition = checks.get(name);
  if (definition === undefined) throw new Error(`There is no check named ${name}.`);
  return definition;
}

/** The text literals in a check, in order. */
const literals = (name: string) =>
  [...check(name).matchAll(/'((?:[^']|'')*)'::text/g)].map((match) => match[1] ?? '');

describe('the forms checks in migration 0079', () => {
  it('copy who may answer, the routes, the version statuses and the spam reasons', () => {
    expect(literals('form_respondents_check')).toEqual(forms.respondentOptions);
    expect(literals('form_version_respondents_check')).toEqual(forms.respondentOptions);
    expect(literals('response_route_check')).toEqual(forms.responseRoutes);
    expect(literals('form_version_status_check')).toEqual(forms.formStatuses);
    expect(literals('response_spam_reason_check')).toEqual(forms.spamReasons);
  });

  it('copy the retention range, default and anonymous cap', () => {
    const { min, max } = forms.RETENTION_MONTHS;
    expect(check('form_retention_months_check')).toBe(
      `CHECK (((retention_months >= ${String(min)}) AND (retention_months <= ${String(max)})))`,
    );
    expect(retentionDefault).toBe(String(forms.DEFAULT_RETENTION_MONTHS));
    expect(check('form_anonymous_retention')).toContain(
      `(retention_months <= ${String(forms.ANONYMOUS_RETENTION_MONTHS)})`,
    );
  });

  it('allow twice the contracts byte limits, as jsonb text adds spaces', () => {
    expect(check('form_version_definition_size')).toContain(
      `<= ${String(2 * forms.FORM_DEFINITION_MAX_BYTES)}`,
    );
    expect(check('response_answers_size')).toContain(
      `<= ${String(2 * forms.PUBLIC_SUBMIT_MAX_BYTES)}`,
    );
  });

  it('copy the caps on titles, descriptions and confirmation messages', () => {
    expect(check('form_title_check')).toContain('(char_length(title) <= 200)');
    expect(check('form_description_check')).toContain('(char_length(description) <= 2000)');
    expect(check('form_confirmation_message_check')).toContain(
      '(char_length(confirmation_message) <= 2000)',
    );
  });
});
