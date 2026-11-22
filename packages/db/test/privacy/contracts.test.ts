// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The checks in migrations 0089 to 0091 copy lists and caps from the privacy
// contracts, and module ids from the domain. This reads each check back from
// the database and compares it with what it copies, so neither can change
// alone. packages/db has no dependency on a module, so the contracts are
// loaded by path at run time rather than imported.

import { moduleIds } from '@pixel-scientists/domain/platform';
import { beforeAll, describe, expect, it } from 'vitest';

import { withClient } from '../connect.ts';

interface FieldSchema {
  readonly safeParse: (value: unknown) => { readonly success: boolean };
}
type Contracts = Readonly<Record<string, unknown>>;

const CONTRACTS = new URL('../../../../modules/privacy/src/contracts/index.ts', import.meta.url);

let privacy: Contracts;
/** Each check in a schema, by name, as pg_get_constraintdef prints it. */
let checks: Map<string, string>;
let grantsText: Map<string, string>;

beforeAll(async () => {
  privacy = (await import(CONTRACTS.href)) as Contracts;
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
  checks = await read('privacy');
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

const list = (name: string) => privacy[name] as readonly string[];
const field = (schema: string, name: string) =>
  (privacy[schema] as { readonly shape: Readonly<Record<string, FieldSchema>> }).shape[name];

describe('the privacy checks in migrations 0089 to 0091', () => {
  it('copy the request, clock, breach, DPIA and processing lists', () => {
    const lists: Readonly<Record<string, readonly string[]>> = {
      rights_request_kind_check: list('requestKinds'),
      rights_request_channel_check: list('requestChannels'),
      rights_request_identity_check_check: list('identityChecks'),
      breach_data_categories_known: list('dataCategories'),
      breach_ico_late_reason_check: list('lateReasons'),
      breach_subjects_notice_method_check: list('notificationMethods'),
      breach_assessment_risk_level_check: list('riskLevels'),
      dpia_status_check: list('dpiaStatuses'),
      processing_activity_legal_basis_check: list('legalBases'),
      processing_activity_special_category_condition_check: list('specialCategoryConditions'),
      processing_activity_data_categories_known: list('dataCategories'),
      processing_activity_subject_categories_known: list('subjectCategories'),
      processor_transfer_safeguard_check: list('transferSafeguards'),
      request_task_module_id_check: moduleIds,
    };
    for (const [name, values] of Object.entries(lists))
      expect(literals(name), name).toEqual(values);
  });

  it('copy each clock event reason list, by kind', () => {
    const reasons: Readonly<Record<string, readonly string[]>> = {
      request_clock_event_pause_reason: ['paused', ...list('pauseReasons')],
      request_clock_event_resume_reason: ['resumed', ...list('resumeReasons')],
      request_clock_event_extension_reason: ['extended', ...list('extensionReasons')],
      request_clock_event_close_reason: ['closed', ...list('closeReasons')],
    };
    for (const [name, values] of Object.entries(reasons))
      expect(literals(name), name).toEqual(values);
    expect(literals('request_clock_event_kind_check')).toEqual([
      'paused',
      'resumed',
      'extended',
      'closed',
    ]);
  });

  it('store every clock state but overdue, which depends on today', () => {
    expect(literals('rights_request_clock_state_check')).toEqual(
      list('clockStates').filter((state) => state !== 'overdue'),
    );
  });

  it("copy each text cap, which the contract's schema also holds", () => {
    const caps: readonly [string, string, string, number][] = [
      ['rights_request_summary_check', 'rightsRequestUpdateSchema', 'summary', 2000],
      ['request_task_title_check', 'requestTaskInputSchema', 'title', 200],
      ['breach_description_check', 'breachUpdateSchema', 'description', 5000],
      ['breach_consequences_check', 'breachUpdateSchema', 'likelyConsequences', 5000],
      ['breach_measures_check', 'breachUpdateSchema', 'measuresTaken', 5000],
      ['breach_ico_reference_check', 'icoNotificationInputSchema', 'reference', 100],
      ['breach_assessment_rationale_check', 'assessmentInputSchema', 'rationale', 5000],
      ['dpia_title_check', 'dpiaInputSchema', 'title', 200],
      ['dpia_dpo_advice_check', 'dpiaInputSchema', 'dpoAdvice', 10_000],
      ['processing_activity_name_check', 'processingActivityInputSchema', 'name', 200],
      ['processing_activity_purpose_check', 'processingActivityInputSchema', 'purpose', 2000],
      ['processing_activity_recipients_check', 'processingActivityInputSchema', 'recipients', 2000],
      [
        'processing_activity_transfers_abroad_check',
        'processingActivityInputSchema',
        'transfersAbroad',
        2000,
      ],
      ['processing_activity_retention_check', 'processingActivityInputSchema', 'retention', 1000],
      [
        'processing_activity_security_measures_check',
        'processingActivityInputSchema',
        'securityMeasures',
        2000,
      ],
      ['processor_name_check', 'processorInputSchema', 'name', 200],
      ['processor_service_check', 'processorInputSchema', 'service', 300],
    ];
    for (const [name, schema, input, cap] of caps) {
      const parse = field(schema, input);
      expect(parse?.safeParse('a'.repeat(cap)).success, `${schema}.${input}`).toBe(true);
      expect(parse?.safeParse('a'.repeat(cap + 1)).success, `${schema}.${input}`).toBe(false);
      expect(check(name), name).toContain(`<= ${String(cap)})`);
    }
  });

  it('use the grants schema text patterns for lines and paragraphs', () => {
    const pattern = (definition: string) => /!~ '((?:[^']|'')*)'/.exec(definition)?.[1];
    const line = pattern(check('programme_title_text', grantsText));
    const text = pattern(check('programme_description_text', grantsText));
    const named = [...checks.keys()].filter((name) => name.endsWith('_text')).sort();
    const lines = [
      'breach_ico_reference_text',
      'dpia_title_text',
      'processing_activity_name_text',
      'processor_name_text',
      'processor_service_text',
      'request_task_title_text',
    ];
    for (const name of named) {
      expect(pattern(check(name)), name).toBe(lines.includes(name) ? line : text);
    }
    expect(named).toHaveLength(17);
  });
});
