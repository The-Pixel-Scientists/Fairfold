// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Every party audit action says whether it carries a subject (ADR 0027). A
// new action fails here until someone decides which it is.

import { describe, expect, it } from 'vitest';

import { partyAuditActions } from '../contracts/index.ts';
import { partySubjectRules } from './audit.ts';
import type { Tx } from './tables.ts';

/** A transaction whose every query finds `row`, or nothing. */
const txFinding = (row: object | undefined): Tx => {
  const query = {
    select: () => query,
    where: () => query,
    executeTakeFirst: () => Promise.resolve(row),
  };
  return { $extendTables: () => ({ selectFrom: () => query }) } as unknown as Tx;
};

const ID = '0b5d1c4e-6f3a-4d2b-9c8e-1a2b3c4d5e6f';

describe('the party audit actions', () => {
  it('each carry a subject or give a reason for having none, and no other is listed', () => {
    expect(Object.keys(partySubjectRules).sort()).toEqual([...partyAuditActions].sort());
    for (const rule of Object.values(partySubjectRules)) {
      if ('none' in rule) expect(rule.none.length).toBeGreaterThan(0);
      else expect(rule.subject).toBeTypeOf('function');
    }
  });

  it('find the person or organisation, and nothing for a record the tenant cannot see', async () => {
    const found = txFinding({ id: ID, subject_id: ID, person_id: ID, organisation_id: ID });
    const missing = txFinding(undefined);
    const event = { entityId: crypto.randomUUID() };
    for (const action of partyAuditActions) {
      const rule = partySubjectRules[action];
      if ('none' in rule) continue;
      expect(await rule.subject(found, event), action).toBe(ID);
      expect(await rule.subject(missing, event), action).toBeNull();
    }
  });
});
