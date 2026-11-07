// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Every grants audit action says whether it carries a subject (ADR 0027). A
// new action fails here until someone decides which it is.

import { describe, expect, it } from 'vitest';

import { grantsAuditActions } from '../contracts/index.ts';
import { grantsSubjectRules } from './audit.ts';
import type { Tx } from './programme/tables.ts';

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
const row = {
  applicant_person_id: ID,
  application_id: ID,
  recipient_person_id: ID,
  organisation_id: ID,
};
const removal = { 'grants.assignment.application_id': { before: ID, after: null } };

describe('the grants audit actions', () => {
  it('each carry a subject or give a reason for having none, and no other is listed', () => {
    expect(Object.keys(grantsSubjectRules).sort()).toEqual([...grantsAuditActions].sort());
    for (const rule of Object.values(grantsSubjectRules)) {
      if ('none' in rule) expect(rule.none.length).toBeGreaterThan(0);
      else expect(rule.subject).toBeTypeOf('function');
    }
  });

  it('find the applicant, and nothing for a record the tenant cannot see', async () => {
    const event = { entityId: crypto.randomUUID(), changes: removal };
    for (const action of grantsAuditActions) {
      const rule = grantsSubjectRules[action];
      if ('none' in rule) continue;
      expect(await rule.subject(txFinding(row), event), action).toBe(ID);
      expect(await rule.subject(txFinding(undefined), event), action).toBeNull();
    }
  });

  it('find a note or message event subject from the application its entity id names', async () => {
    const lookups: unknown[] = [];
    const query = {
      select: () => query,
      where: (column: string, _op: string, value: unknown) => (lookups.push(column, value), query),
      executeTakeFirst: () => Promise.resolve({ applicant_person_id: ID }),
    };
    const tables = { selectFrom: (table: string) => (lookups.push(table), query) };
    const tx = { $extendTables: () => tables } as unknown as Tx;
    const entityId = crypto.randomUUID();
    for (const action of [
      'grants.application.note_added',
      'grants.application.message_sent',
      'grants.application.messages_viewed',
    ] as const) {
      lookups.length = 0;
      const rule = grantsSubjectRules[action];
      if ('none' in rule) throw new Error(`${action} has a subject.`);
      expect(await rule.subject(tx, { entityId }), action).toBe(ID);
      expect(lookups, action).toEqual(['grants.application', 'id', entityId]);
    }
  });

  it('read a deleted assignment application from its own changes, and only if that is an id', async () => {
    const rule = grantsSubjectRules['grants.assignment.removed'];
    if ('none' in rule) throw new Error('A removed assignment has a subject.');
    const tx = txFinding(row);
    const entityId = crypto.randomUUID();
    expect(await rule.subject(tx, { entityId })).toBeNull();
    for (const before of ['not an id', 7, undefined]) {
      const changes = { 'grants.assignment.application_id': { before } };
      expect(await rule.subject(tx, { entityId, changes })).toBeNull();
    }
  });
});
