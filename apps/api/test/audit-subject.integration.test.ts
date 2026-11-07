// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The party each party and grants audit event is about (ADR 0027), through
// the whole API against the test database, as app_api: the applicant's party
// on a submit, a decision release and a removed assignment; no subject on
// configuration events; and a record in another tenant finds nothing, so the
// event is refused.

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { trustedTenantId } from '../../../packages/db/src/tenant-context.ts';
import { loadConfig } from '../src/config.ts';
import { withSubjects, type RequestAudit } from '../src/context.ts';
import { openDatabase } from '../src/database.ts';
import { createLogger } from '../src/logger.ts';
import { accepted, startDecisionsApi, type DecisionsApi } from './decisions-api.ts';
import { answer } from './programme-api.ts';
import { smtpTestSettings } from './support.ts';

// Each request runs a few statements in a transaction, which is slow on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

let t: DecisionsApi;
let database: ReturnType<typeof openDatabase>;

beforeAll(async () => {
  t = await startDecisionsApi('41070');
  const { database: settings } = loadConfig({
    ...process.env,
    ...smtpTestSettings,
    TPS_API_PORT: '41070',
    TPS_DB_NAME: process.env['TPS_TEST_DB_NAME'],
  });
  database = openDatabase(settings, createLogger({ level: 'silent' }));
}, 60_000);

afterAll(async () => {
  await database.close();
  await t.close();
});

interface Subjected {
  action: string;
  entity_id: string;
  subject: string | null;
}

const subjects = (action: string, entityIds: string[]) =>
  t.rows<Subjected>(
    `SELECT action, entity_id, subject_party_id AS subject FROM app.audit_event
      WHERE action = $1 AND entity_id = ANY($2) ORDER BY occurred_at, id`,
    [action, entityIds],
  );

const applicantOf = async (applicationId: string) =>
  (
    await t.rows<{ applicant_person_id: string }>(
      'SELECT applicant_person_id FROM grants.application WHERE id = $1',
      [applicationId],
    )
  )[0]?.applicant_person_id;

describe('the subject of an event', () => {
  it('is the applicant on a submit, a decision, its release and its email', async () => {
    const round = await t.reviewRound();
    const roundId = round.open.round.id;
    const submission = await t.submission(round);
    await t.recorded(submission, accepted());
    await answer(t.release(roundId));
    const applicant = await applicantOf(submission);
    const [decision] = await t.decisions<{ id: string }>('d.application_id = $1', [submission]);
    const [email] = await t.rows<{ id: string }>(
      'SELECT id FROM grants.decision_email WHERE decision_id = $1',
      [decision?.id],
    );

    expect(applicant).toBeDefined();
    const expected = [
      ['grants.application.created', submission],
      ['grants.application.submitted', submission],
      ['grants.application.stage_changed', submission],
      ['grants.decision.recorded', decision?.id],
      ['grants.decision.released', decision?.id],
      ['grants.decision_email.sent', email?.id],
    ] as const;
    for (const [action, entityId] of expected) {
      expect(await subjects(action, [entityId ?? '']), action).toEqual([
        { action, entity_id: entityId, subject: applicant },
      ]);
    }
    // The applicant's own person event, written by the grants handler.
    expect(await subjects('party.person.created', [applicant ?? ''])).toEqual([
      { action: 'party.person.created', entity_id: applicant, subject: applicant },
    ]);
  });

  it('is the applicant when an assignment has been deleted', async () => {
    const { submissionId } = await t.assigned(t.grace);
    const [assignment] = [...(await t.assignmentsOf(submissionId)).values()];
    const removed = await t.send(t.managerA, 'DELETE', `/console/assignments/${assignment}`);
    expect(removed.statusCode).toBe(204);

    expect(await subjects('grants.assignment.created', [assignment ?? ''])).toMatchObject([
      { subject: await applicantOf(submissionId) },
    ]);
    expect(await subjects('grants.assignment.removed', [assignment ?? ''])).toMatchObject([
      { subject: await applicantOf(submissionId) },
    ]);
  });

  it('is none on a configuration event and on a reviewer joining the pool', async () => {
    const round = await t.reviewRound();
    const roundId = round.open.round.id;
    await answer(t.pool(round.open, t.grace));
    const [reviewer] = await t.rows<{ id: string }>(
      'SELECT id FROM grants.reviewer WHERE round_id = $1',
      [roundId],
    );

    expect(await subjects('grants.round.created', [roundId])).toMatchObject([{ subject: null }]);
    expect(await subjects('grants.reviewer.added', [reviewer?.id ?? ''])).toMatchObject([
      { subject: null },
    ]);
  });
});

describe('across tenants', () => {
  it('finds no applicant for another tenant’s application, and refuses the event', async () => {
    const round = await t.reviewRound();
    const submission = await t.submission(round);
    const recorded: unknown[] = [];
    const inner: RequestAudit = {
      record: (event) => Promise.resolve(void recorded.push(event)),
      read: (event) => Promise.resolve(void recorded.push(event)),
    };

    const tenantB = trustedTenantId(t.tenantB.id);
    await database.inTenant(tenantB, async (tx) => {
      const audit = withSubjects(tx, inner);
      const action = 'grants.application.submitted';
      await expect(audit.record({ action, entityId: submission })).rejects.toThrow(
        'The audit event has no subject.',
      );
      await expect(audit.read({ action, entityId: randomUUID() })).rejects.toThrow(
        'The audit event has no subject.',
      );
    });
    expect(recorded).toEqual([]);

    const tenantA = trustedTenantId(t.tenantA.id);
    await database.inTenant(tenantA, async (tx) => {
      await withSubjects(tx, inner).record({
        action: 'grants.application.submitted',
        entityId: submission,
      });
    });
    expect(recorded).toEqual([
      {
        action: 'grants.application.submitted',
        entityId: submission,
        subjectPartyId: await applicantOf(submission),
      },
    ]);
  });
});
