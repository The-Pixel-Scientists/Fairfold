// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ctx.audit gives each party and grants event the party it is about, and
// refuses one that needs a subject and has none (ADR 0027).

import { grantsAuditActions } from '@pixel-scientists/grants/contracts';
import { partyAuditActions } from '@pixel-scientists/party/contracts';
import { describe, expect, it } from 'vitest';

import type { AuditEvent } from './audit/writer.ts';
import { withSubjects, type RequestAudit } from './context.ts';
import type { TenantTransaction } from './database.ts';

const ID = '0b5d1c4e-6f3a-4d2b-9c8e-1a2b3c4d5e6f';

/** A transaction whose every query finds `row`, or nothing. */
const txFinding = (row: object | undefined): TenantTransaction => {
  const query = {
    select: () => query,
    where: () => query,
    executeTakeFirst: () => Promise.resolve(row),
  };
  return { $extendTables: () => ({ selectFrom: () => query }) } as unknown as TenantTransaction;
};
const found = txFinding({
  id: ID,
  subject_id: ID,
  person_id: ID,
  applicant_person_id: ID,
  application_id: ID,
  recipient_person_id: ID,
});

function recorder() {
  const seen: { kind: 'record' | 'read'; event: AuditEvent }[] = [];
  const audit: RequestAudit = {
    record: (event) => Promise.resolve(void seen.push({ kind: 'record', event })),
    read: (event) => Promise.resolve(void seen.push({ kind: 'read', event })),
  };
  return { seen, audit };
}

describe('withSubjects', () => {
  it('sets the subject on every action that has one, and changes nothing else', async () => {
    const { seen, audit } = recorder();
    const subjected = withSubjects(found, audit);
    const changes = {
      'grants.assignment.application_id': { before: ID, after: null },
      'party.person.email': {},
    };
    const actions = [...partyAuditActions, ...grantsAuditActions];
    for (const action of actions) await subjected.record({ action, entityId: ID, changes });

    expect(seen).toHaveLength(actions.length);
    for (const { event } of seen) {
      expect(event.changes, event.action).toBe(changes);
      expect(event.entityId).toBe(ID);
      expect(Object.keys(event)).toEqual(expect.arrayContaining(['action', 'entityId', 'changes']));
    }
    const subjectOf = (action: string) =>
      seen.find(({ event }) => event.action === action)?.event.subjectPartyId;
    for (const action of [
      'party.person.updated',
      'party.consent.recorded',
      'grants.application.submitted',
      'grants.assignment.removed',
      'grants.decision.released',
      'grants.decision_email.resent',
    ]) {
      expect(subjectOf(action), action).toBe(ID);
    }
    for (const action of ['grants.round.created', 'grants.reviewer.added']) {
      expect(subjectOf(action), action).toBeUndefined();
    }
  });

  it('sets the subject on a sensitive read', async () => {
    const { seen, audit } = recorder();
    await withSubjects(found, audit).read({ action: 'grants.application.viewed', entityId: ID });
    expect(seen).toEqual([
      {
        kind: 'read',
        event: { action: 'grants.application.viewed', entityId: ID, subjectPartyId: ID },
      },
    ]);
  });

  it('passes platform actions through unchanged, without a query', async () => {
    const { seen, audit } = recorder();
    const event = { action: 'platform.membership.suspended', entityId: ID } as const;
    await withSubjects(txFinding(undefined), audit).record(event);
    expect(seen).toEqual([{ kind: 'record', event }]);
  });

  it('refuses an event whose record is not found, in words that echo nothing', async () => {
    const { seen, audit } = recorder();
    const subjected = withSubjects(txFinding(undefined), audit);
    const entityId = '7e1a9c52-3b84-4f06-a1d9-5c2e8b7f0a34';
    const refused = [
      subjected.record({ action: 'grants.application.submitted', entityId }),
      subjected.record({ action: 'party.consent.recorded', entityId }),
      subjected.read({ action: 'party.person.viewed', entityId }),
    ];
    for (const attempt of refused) {
      await expect(attempt).rejects.toThrow(/^The audit event has no subject\.$/);
    }
    expect(seen).toEqual([]);
  });
});
