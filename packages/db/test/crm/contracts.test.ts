// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The checks in migration 0063 copy lists, patterns and caps from S11-51's
// crm contracts. This reads each check back from the database and compares
// it with what it copies, so neither can change alone, and runs the segment
// definition check against the filter allowlist: every field on it is
// accepted, none is personal or special category, and a field off it is
// refused. packages/db has no dependency on a module, so the contracts are
// loaded by path at run time rather than imported.

import { moduleIds } from '@pixel-scientists/domain/platform';
import { beforeAll, describe, expect, it } from 'vitest';

import { withClient } from '../connect.ts';
import { asMigratorIn, createTestTenant, type TestTenant } from '../tenants.ts';
import { addCrmParts, filters, insertOutcome, segmentRow, type CrmParts } from './fixtures.ts';

interface CrmContracts {
  readonly interactionKinds: readonly string[];
  readonly manualInteractionKinds: readonly string[];
  readonly INTERACTION_SUMMARY_MAX: number;
  readonly importStates: readonly string[];
  readonly importFailures: readonly string[];
  readonly importFieldIds: readonly string[];
  readonly importRowErrorCodes: readonly string[];
  readonly IMPORT_MAX_ROWS: number;
  readonly IMPORT_MAX_COLUMNS: number;
  readonly externalSystems: readonly string[];
  readonly EXTERNAL_ID: RegExp;
  readonly EXTERNAL_URL_MAX: number;
  readonly mergeRecordKinds: readonly string[];
  readonly segmentFieldIds: readonly string[];
  readonly segmentFields: Readonly<Record<string, { readonly sensitivity: string }>>;
  readonly segmentOperators: readonly string[];
  readonly MAX_SEGMENT_FILTERS: number;
}

const CONTRACTS = new URL('../../../../modules/crm/src/contracts/index.ts', import.meta.url);

let crm: CrmContracts;
/** Each check in the crm schema, by name, as pg_get_constraintdef prints it. */
let checks: Map<string, string>;
let grantsText: Map<string, string>;
let tenant: TestTenant;
let parts: CrmParts;

beforeAll(async () => {
  crm = (await import(CONTRACTS.href)) as CrmContracts;
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
  checks = await read('crm');
  grantsText = await read('grants');
  tenant = await createTestTenant();
  parts = await asMigratorIn(tenant.id, (client) => addCrmParts(client, tenant));
}, 60_000);

function check(name: string, from = checks): string {
  const definition = from.get(name);
  if (definition === undefined) throw new Error(`There is no check named ${name}.`);
  return definition;
}

/** The text literals in a check, in order. */
const literals = (name: string) =>
  [...check(name).matchAll(/'((?:[^']|'')*)'::text/g)].map((match) =>
    (match[1] ?? '').replaceAll("''", "'"),
  );

/** The alternatives of each `like_regex "^(a|b)$"` in a check, in order. */
const alternations = (name: string) =>
  [...check(name).matchAll(/like_regex "\^\(([a-z0-9_|]+)\)\$"/g)].map((match) =>
    (match[1] ?? '').split('|'),
  );

const sorted = (values: readonly string[]) => [...values].sort();

describe('the crm checks in migration 0063', () => {
  it('copy the interaction kinds, modules and summary cap', () => {
    expect(literals('interaction_kind_check')).toEqual(crm.interactionKinds);
    expect(sorted(literals('interaction_source_module_check'))).toEqual(sorted(moduleIds));
    for (const type of literals('interaction_source_entity_type_check')) {
      expect(moduleIds).toContain(type.split('.')[0]);
    }
    const manual = check('interaction_source').split('ELSE')[0] ?? '';
    for (const kind of crm.interactionKinds) {
      expect(manual.includes(`'${kind}'`), kind).toBe(crm.manualInteractionKinds.includes(kind));
    }
    expect(check('interaction_summary_check')).toContain(
      `<= ${String(crm.INTERACTION_SUMMARY_MAX)}`,
    );
  });

  it('copy the import states, failures, field ids, codes and caps', () => {
    expect(literals('import_job_state_check')).toEqual(crm.importStates);
    expect(literals('import_job_error_code_check')).toEqual(crm.importFailures);
    expect(literals('import_job_target_kind_check')).toEqual(['organisation', 'person']);
    expect(alternations('import_job_mapping')).toEqual([[...crm.importFieldIds]]);
    expect(alternations('import_row_cells')).toEqual([[...crm.importFieldIds]]);
    expect(alternations('import_row_errors')).toEqual([
      ['field', 'code'],
      [...crm.importFieldIds],
      [...crm.importRowErrorCodes],
    ]);
    expect(check('import_job_row_count_check')).toContain(String(crm.IMPORT_MAX_ROWS));
    expect(check('import_job_mapping')).toContain(`<= ${String(crm.IMPORT_MAX_COLUMNS)})`);
  });

  it('copy the external systems, id pattern and address cap', () => {
    expect(literals('external_reference_system_check')).toEqual(crm.externalSystems);
    expect(literals('external_reference_external_id_check')).toEqual([crm.EXTERNAL_ID.source]);
    expect(check('external_reference_url_check')).toContain(`<= ${String(crm.EXTERNAL_URL_MAX)}`);
  });

  it('copy the merge record kinds and party kinds', () => {
    // ADR 0025 is proposed, so the database allows merge alone until the
    // reversal and the rows it needs are added.
    expect(literals('merge_record_action_check')).toEqual(['merge']);
    expect(crm.mergeRecordKinds).toContain('merge');
    expect(literals('merge_record_kind_check')).toEqual(['organisation', 'person']);
    expect(alternations('merge_record_counts')[0]).toEqual([...moduleIds]);
  });

  it('copy the segment fields and operators', () => {
    expect(alternations('segment_definition_filters')).toEqual([
      ['field', 'operator', 'value'],
      [...crm.segmentFieldIds],
      [...crm.segmentOperators],
    ]);
    expect(check('segment_definition_filters')).toContain(`<= ${String(crm.MAX_SEGMENT_FILTERS)})`);
  });

  it('use the grants schema text patterns for names, descriptions and summaries', () => {
    const pattern = (definition: string) => /!~ '((?:[^']|'')*)'/.exec(definition)?.[1];
    const line = pattern(check('programme_title_text', grantsText));
    const text = pattern(check('programme_description_text', grantsText));
    for (const name of ['list_name_text', 'segment_name_text']) {
      expect(pattern(check(name)), name).toBe(line);
    }
    for (const name of [
      'list_description_text',
      'segment_description_text',
      'interaction_summary_text',
    ]) {
      expect(pattern(check(name)), name).toBe(text);
    }
  });
});

describe('the segment filter allowlist', { timeout: 30_000 }, () => {
  it('names no personal, special category or hidden field', () => {
    for (const field of crm.segmentFieldIds) {
      expect(['public', 'internal'], field).toContain(crm.segmentFields[field]?.sensitivity);
    }
  });

  it('is exactly what the definition check accepts', async () => {
    const add = (field: string) =>
      insertOutcome(
        'app_api',
        tenant,
        'crm.segment',
        segmentRow(tenant, parts.member, { definition: filters(field, 'eq', 'x') }),
      );
    for (const field of crm.segmentFieldIds) expect(await add(field), field).toBe('ok');
    for (const field of [
      'email',
      'given_name',
      'family_name',
      'phone',
      'postcode',
      'name',
      'Kind',
    ]) {
      expect(await add(field), field).toBe('23514');
    }
  });
});
