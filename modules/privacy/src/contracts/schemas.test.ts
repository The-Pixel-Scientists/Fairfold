// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import * as contracts from './index.ts';

const id = '0b8f3a52-6c1d-4e7a-9f20-3d5c8e1b7a64';
const other = '9e8d7c6b-5a49-4382-9716-05f4e3d2c1b0';

function accepts<S extends z.ZodType>(schema: S, value: z.input<S>, changes: object[]) {
  expect(schema.safeParse(value).success).toBe(true);
  for (const change of changes) {
    const changed = { ...(value as object), ...change };
    expect(schema.safeParse(changed).success, JSON.stringify(change)).toBe(false);
  }
}

describe('request schemas', () => {
  it('log a rights request about one person, with a capped summary', () => {
    accepts(
      contracts.rightsRequestInputSchema,
      {
        personId: id,
        receivedAt: '2026-11-02T09:00:00Z',
        kind: 'automated_decision',
        channel: 'web_form',
        summary: 'Asked for a copy of\r\nher application.',
        identityCheck: 'requested',
      },
      [
        { personId: [id] },
        { receivedAt: '2026-11-02' },
        { summary: '  ' },
        { summary: 'x'.repeat(2001) },
        { identityDocument: 'passport' },
      ],
    );
  });

  it('extend by 1 or 2 months with a reason, and move the clock with a date and a reason', () => {
    accepts(contracts.extensionInputSchema, { on: '2026-11-20', months: 2, reason: 'numerous' }, [
      { months: 0 },
      { months: 1.5 },
      { on: '20/11/2026' },
    ]);
    accepts(contracts.pauseInputSchema, { on: '2026-11-20', reason: 'identity_proof' }, [
      { reason: undefined },
      { membershipId: id },
    ]);
  });

  it('assign a task to a member and, optionally, a tool', () => {
    accepts(
      contracts.requestTaskInputSchema,
      { title: 'Check grants records', assigneeMembershipId: id, moduleId: 'grants', dueOn: null },
      [{ moduleId: 'platform2' }, { title: 'Check\nrecords' }],
    );
  });

  it('record a breach with counts that may be unknown, but not negative or fractional', () => {
    accepts(
      contracts.breachInputSchema,
      {
        becameAwareAt: '2026-11-02T09:00:00Z',
        discoveredAt: '2026-11-01T17:00:00Z',
        description: 'A spreadsheet was emailed to the wrong person.',
        dataCategories: ['contact', 'health'],
        approximateSubjects: 40,
        approximateRecords: null,
        likelyConsequences: '',
        measuresTaken: 'Asked the recipient to delete it.',
      },
      [
        { approximateSubjects: -1 },
        { approximateRecords: 2.5 },
        { dataCategories: ['health', 'health'] },
      ],
    );
    expect(contracts.breachUpdateSchema.shape).not.toHaveProperty('becameAwareAt');
  });

  it('key screening answers and risks by stable ids, each once', () => {
    const risk = {
      id: 'r_1',
      description: 'Re-identification',
      likelihood: 'possible',
      severity: 'severe',
      mitigation: '',
    };
    accepts(
      contracts.dpiaInputSchema,
      {
        title: 'Equality monitoring',
        processingActivityIds: [id, other],
        screening: { q_special: 'yes', q_large: 'unsure' },
        risks: [risk],
        dpoAdvice: '',
      },
      [
        { screening: { tenant_id: 'yes' } },
        { screening: { 'Do you process health data?': 'yes' } },
        { risks: [risk, risk] },
        { processingActivityIds: [id, id] },
        { status: 'signed_off' },
      ],
    );
  });

  it('take lawful bases and processor countries from checked lists', () => {
    accepts(
      contracts.processorInputSchema,
      {
        name: 'Mail House',
        service: 'Prints and posts letters',
        countryCode: 'GB',
        contractSignedOn: '2026-01-05',
        transferSafeguard: null,
      },
      [{ countryCode: 'GBR' }, { transferSafeguard: 'contract' }],
    );
    expect(contracts.legalBases).toContain('recognised_legitimate_interests');
    expect(contracts.specialCategoryData.every((c) => contracts.dataCategories.includes(c))).toBe(
      true,
    );
  });
});
