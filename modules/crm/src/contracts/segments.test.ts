// SPDX-License-Identifier: AGPL-3.0-or-later

import { configDiffSchemas } from '@pixel-scientists/domain/platform/settings';
import { describe, expect, it } from 'vitest';

import { crmMessages } from './messages.ts';
import { segmentDiff, segmentFields, segmentInputSchema } from './segments.ts';

const f1 = '0190f0a0-0000-7000-8000-0000000000f1';
const f2 = '0190f0a0-0000-7000-8000-0000000000f2';
const orgId = '0190f0a0-0000-7000-8000-000000000001';

const segment = {
  name: 'Charities we fund',
  filters: {
    [f1]: { field: 'legal_form', operator: 'eq', value: 'registered_charity' },
    [f2]: { field: 'last_interaction', operator: 'after', value: '2026-01-01' },
  },
};

const filter = (value: object) => ({ ...segment, filters: { [f1]: value } });

const messages = (input: unknown) =>
  segmentInputSchema.safeParse(input).error?.issues.map((issue) => issue.message);

describe('segment filters', () => {
  it('use a closed list of fields, none personal, special category or hidden', () => {
    expect(Object.keys(segmentFields)).toEqual([
      'kind',
      'status',
      'legal_form',
      'identifier_scheme',
      'list',
      'contact_for',
      'interaction_kind',
      'last_interaction',
      'created',
    ]);
    for (const { sensitivity } of Object.values(segmentFields)) {
      expect(['public', 'internal']).toContain(sensitivity);
    }
  });

  it.each([
    'email',
    'given_name',
    'family_name',
    'phone',
    'match_name',
    'address_postcode',
    'user_id',
    'merged_into',
    'ethnicity',
    'disability',
    'monitoring',
    'answers.f_abc',
  ])('refuses the field %s', (field) => {
    expect(messages(filter({ field, operator: 'eq', value: 'x' }))).toEqual([
      crmMessages.segmentField,
    ]);
  });

  it('accepts a segment and refuses a comparison or value that does not fit its field', () => {
    expect(segmentInputSchema.safeParse(segment).success).toBe(true);
    expect(
      segmentInputSchema.safeParse(filter({ field: 'contact_for', operator: 'eq', value: orgId }))
        .success,
    ).toBe(true);
    expect(messages(filter({ field: 'kind', operator: 'before', value: 'person' }))).toEqual([
      crmMessages.segmentOperator,
    ]);
    expect(messages(filter({ field: 'contact_for', operator: 'eq', value: 'Northfield' }))).toEqual(
      [crmMessages.segmentValue],
    );
    expect(messages(filter({ field: 'created', operator: 'after', value: 'last week' }))).toEqual([
      crmMessages.segmentValue,
    ]);
  });

  it('take 1 to 10 filters, keyed by lower-case uuid, with no other keys', () => {
    expect(messages({ ...segment, filters: {} })).toEqual([crmMessages.segmentFilters]);
    expect(
      segmentInputSchema.safeParse({ ...segment, filters: { f_1: segment.filters[f1] } }).success,
    ).toBe(false);
    expect(
      segmentInputSchema.safeParse(filter({ ...segment.filters[f1], label: 'x' })).success,
    ).toBe(false);
  });
});

describe('segment config diffs', () => {
  it('record fields and comparisons, never a filter value', () => {
    const before = segmentInputSchema.parse(segment);
    const after = segmentInputSchema.parse({
      ...segment,
      filters: {
        [f1]: { field: 'contact_for', operator: 'eq', value: orgId },
        [f2]: { field: 'last_interaction', operator: 'before', value: '2025-12-31' },
      },
    });
    const created = segmentDiff(null, before);
    const changed = segmentDiff(before, after);
    for (const diff of [created, changed]) {
      expect(configDiffSchemas['crm.segment'].safeParse(diff).success).toBe(true);
      const text = JSON.stringify(diff);
      for (const value of ['registered_charity', '2026-01-01', '2025-12-31', orgId]) {
        expect(text).not.toContain(value);
      }
    }
    expect(changed).toEqual([
      { path: `filters.${f1}.field`, from: 'legal_form', to: 'contact_for' },
      { path: `filters.${f1}.operator`, from: 'eq', to: 'eq' },
      { path: `filters.${f2}.field`, from: 'last_interaction', to: 'last_interaction' },
      { path: `filters.${f2}.operator`, from: 'after', to: 'before' },
    ]);
  });

  it('records a filter whose value alone changed by its field and operator, not the value', () => {
    const otherOrgId = '0190f0a0-0000-7000-8000-000000000002';
    const pointed = (value: string) =>
      segmentInputSchema.parse(filter({ field: 'contact_for', operator: 'eq', value }));
    const diff = segmentDiff(pointed(orgId), pointed(otherOrgId));
    expect(diff).toEqual([
      { path: `filters.${f1}.field`, from: 'contact_for', to: 'contact_for' },
      { path: `filters.${f1}.operator`, from: 'eq', to: 'eq' },
    ]);
    expect(configDiffSchemas['crm.segment'].safeParse(diff).success).toBe(true);
    expect(JSON.stringify(diff)).not.toMatch(new RegExp(`${orgId}|${otherOrgId}`));
  });

  it('records nothing when nothing changed, so no version is written', () => {
    const same = segmentInputSchema.parse(segment);
    expect(segmentDiff(same, segmentInputSchema.parse(segment))).toEqual([]);
  });
});
