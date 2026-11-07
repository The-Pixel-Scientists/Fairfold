// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, expectTypeOf, it } from 'vitest';

import type {
  ErasureContribution,
  ErasureSubject,
  SubjectDataContribution,
} from './contribution.ts';
import { erasureCountsSchema } from './erasure.ts';
import { subjectAccessExportSchema, subjectDataSchema, type SubjectData } from './schemas.ts';

interface Tx {
  readonly tx: true;
}

const partyId = '0b8f3a52-6c1d-4e7a-9f20-3d5c8e1b7a64';
const tenantId = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';

const rows: SubjectData = {
  'party.person': [
    {
      'party.person.id': { value: partyId, sensitivity: 'internal' },
      'party.person.given_name': { value: 'Ada', sensitivity: 'personal' },
    },
  ],
  'grants.application': [
    {
      'grants.application.status': { value: 'submitted', sensitivity: 'internal' },
      f_lived1: { value: ['Yes'], sensitivity: 'special_category' },
      f_budget1: { value: [{ item: 'Hall hire', cost: 400 }], sensitivity: 'internal' },
    },
  ],
};

describe('SubjectDataContribution', () => {
  const contribution: SubjectDataContribution<'grants', Tx> = {
    module: 'grants',
    subjectData: () => Promise.resolve(rows),
  };

  it('takes the transaction and one subject party id, and no tenant', () => {
    expectTypeOf(contribution.subjectData).parameters.toEqualTypeOf<[Tx, string]>();
    // @ts-expect-error The tenant comes from the transaction.
    void contribution.subjectData({ tx: true }, partyId, tenantId);
    // @ts-expect-error The subject is a party id, not an object naming a tenant.
    void contribution.subjectData({ tx: true }, { tenantId, partyId });
  });

  it('yields rows by table, each value keyed by field id with its sensitivity', async () => {
    expect(subjectDataSchema.parse(await contribution.subjectData({ tx: true }, partyId))).toEqual(
      rows,
    );
    for (const data of [
      { person: [] },
      { 'party.person': [{ given_name: { value: 'Ada', sensitivity: 'personal' } }] },
      { 'party.person': [{ 'party.person.given_name': { value: 'Ada' } }] },
      { 'party.person': [{ 'party.person.given_name': { value: 'Ada', sensitivity: 'secret' } }] },
    ]) {
      expect(subjectDataSchema.safeParse(data).success, JSON.stringify(data)).toBe(false);
    }
  });
});

describe('ErasureContribution', () => {
  const subject: ErasureSubject = {
    partyId,
    givenName: 'Ada',
    familyName: 'Lovelace',
    email: 'ada@example.org',
    accountId: null,
  };
  const contribution: ErasureContribution<'grants', Tx> = {
    module: 'grants',
    erase: () => Promise.resolve({ 'grants.application': 2 }),
  };

  it('takes the transaction and the subjects, and no tenant', () => {
    expectTypeOf(contribution.erase).parameters.toEqualTypeOf<[Tx, readonly ErasureSubject[]]>();
    expectTypeOf<keyof ErasureSubject>().toEqualTypeOf<
      'partyId' | 'givenName' | 'familyName' | 'email' | 'accountId'
    >();
    // @ts-expect-error The tenant comes from the transaction.
    void contribution.erase({ tx: true }, [subject], tenantId);
    // @ts-expect-error A subject names no tenant.
    void contribution.erase({ tx: true }, [{ ...subject, tenantId }]);
  });

  it('answers counts by table and no field values', async () => {
    expectTypeOf<Awaited<ReturnType<typeof contribution.erase>>>().toEqualTypeOf<
      Record<string, number>
    >();
    const bad: ErasureContribution<'grants', Tx> = {
      module: 'grants',
      // @ts-expect-error A count is a number, never a value.
      erase: () => Promise.resolve({ 'party.person': { given_name: 'Ada' } }),
    };
    expect(bad.module).toBe('grants');
    expect(erasureCountsSchema.parse(await contribution.erase({ tx: true }, [subject]))).toEqual({
      'grants.application': 2,
    });
    for (const counts of [{ 'party.person': 'Ada' }, { 'party.person': 1.5 }, { email: 1 }]) {
      expect(erasureCountsSchema.safeParse(counts).success, JSON.stringify(counts)).toBe(false);
    }
  });
});

describe('subject access export', () => {
  const file = {
    version: 1,
    tenantId,
    subjectPartyId: partyId,
    createdAt: '2026-11-12T10:00:00.000Z',
    modules: { party: { 'party.person': rows['party.person'] }, grants: {} },
    auditEvents: [
      {
        id: tenantId,
        occurredAt: '2026-10-14T13:05:00.000Z',
        action: 'party.person.updated',
        entityType: 'party.person',
        entityId: partyId,
        actor: { kind: 'staff' },
        changes: { 'party.person.given_name': {} },
      },
    ],
  };

  it('holds every module by name, then rows by table, and the audit events', () => {
    expect(subjectAccessExportSchema.parse(file)).toEqual(file);
  });

  it('names no member of staff or other person in the audit events', () => {
    for (const actor of [
      { kind: 'staff', membershipId: tenantId, name: 'Grace Hopper' },
      { kind: 'staff', name: 'Grace Hopper' },
    ]) {
      const events = [{ ...file.auditEvents[0], actor }];
      expect(subjectAccessExportSchema.safeParse({ ...file, auditEvents: events }).success).toBe(
        false,
      );
    }
  });

  it('refuses an unknown module, a top-level key it does not define, or another version', () => {
    for (const changed of [
      { modules: { finance: {} } },
      { version: 2 },
      { requestedBy: 'Grace Hopper' },
    ]) {
      expect(subjectAccessExportSchema.safeParse({ ...file, ...changed }).success).toBe(false);
    }
  });
});
