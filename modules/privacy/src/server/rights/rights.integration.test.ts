// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Export and erasure from a rights request, and the consent audit, against
// the test database as app_api in a tenant's transaction. The platform and
// party are stood in for by a fake bound to the same transaction, which
// reads party's people through row-level security as the real one does, so
// these tests show what privacy asks of them, what it keeps and what it
// writes. The permission, step-up and module-off answers are the platform's,
// in front of these handlers.

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ErasureStatus, JobRequest } from '@pixel-scientists/domain/platform/subject-access';

import { calendarDateIn } from '../../contracts/index.ts';
import type { Tx } from '../context.ts';
import {
  addFixture,
  as,
  clock,
  closeDatabase,
  handlers,
  openDatabase,
  refusal,
  unknownId,
  type Fixture,
} from '../harness.integration.test.ts';
import type { RightsContext, SubjectRights } from './subject-rights.ts';

const SUMMARY = 'Synthetic request for a copy of their records';
const REQUESTED_AT = '2026-11-18T10:00:00.000Z';
const COLUMN = {
  export: 'privacy.rights_request.export_job_request_id',
  erasure: 'privacy.rights_request.erasure_job_request_id',
} as const;

/** The platform's jobs as the fake keeps them, shared by every test. */
const jobs = new Map<string, JobRequest | ErasureStatus>();
const started: { kind: 'export' | 'erasure'; personId: string }[] = [];

const queued = (id: string) => ({ id, requestedAt: REQUESTED_AT, status: 'queued' as const });

type JobRequestTable = {
  'app.job_request': Record<string, unknown>;
};

/** The platform's job request row, which `rights_request` references, as createJobRequest() writes it. */
async function addJobRequest(tx: Tx, member: string, kind: 'subject_access' | 'erasure') {
  const { id } = await tx
    .$extendTables<JobRequestTable>()
    .insertInto('app.job_request')
    .values((eb) => ({
      tenant_id: eb.fn<string>('app.current_tenant_id', []),
      kind,
      requested_by: member,
      permission: `platform.${kind}.request`,
      filters: '{}',
      field_ids: ['party.person.id'],
      output_sensitivity: 'personal',
      request_id: randomUUID(),
    }))
    .returning('id')
    .executeTakeFirstOrThrow();
  return String(id);
}

function fakeRights(tx: Tx, member: string, fail = false): SubjectRights {
  const start = (kind: 'export' | 'erasure') => async (personId: string) => {
    const id = await addJobRequest(tx, member, kind === 'export' ? 'subject_access' : 'erasure');
    if (fail) throw new Error('The platform is down.');
    started.push({ kind, personId });
    jobs.set(id, queued(id));
    return id;
  };
  return {
    startExport: start('export'),
    startErasure: start('erasure'),
    exportStatus: (id) => Promise.resolve((jobs.get(id) as JobRequest | undefined) ?? null),
    erasureStatus: (id) => Promise.resolve((jobs.get(id) as ErasureStatus | undefined) ?? null),
    async consentHistory(personId) {
      const person = await tx
        .$extendTables<{ 'party.person': { id: string } }>()
        .selectFrom('party.person')
        .select('id')
        .where('id', '=', personId)
        .executeTakeFirst();
      return person === undefined
        ? null
        : [
            {
              purpose: 'future_funding',
              channel: 'email',
              state: 'given',
              privacyNoticeVersion: '2026-01',
              recordedAt: REQUESTED_AT,
            },
          ];
    },
  };
}

let a: Fixture;
let b: Fixture;
let today: string;

beforeAll(async () => {
  clock.now = new Date();
  today = calendarDateIn(clock.now.toISOString(), 'Europe/London');
  openDatabase();
  a = await addFixture();
  b = await addFixture();
}, 60_000);

afterAll(closeDatabase);

const withRights = <T>(
  fixture: Fixture,
  work: (context: RightsContext, tx: Tx) => Promise<T>,
  fail = false,
  member = fixture.member,
) =>
  as(fixture, member, (tx, context) =>
    work({ ...context, subjectRights: fakeRights(tx, member, fail) }, tx),
  );

async function log(fixture: Fixture, change: Record<string, unknown> = {}): Promise<string> {
  const { result } = await as(fixture, fixture.member, (tx, context) =>
    handlers.createRightsRequest({
      tx,
      context,
      input: {
        body: {
          personId: fixture.person,
          receivedAt: REQUESTED_AT,
          kind: 'access',
          channel: 'email',
          summary: SUMMARY,
          identityCheck: 'verified',
          ...change,
        } as never,
      },
    }),
  );
  return result.id;
}

const params = (requestId: string) => ({ params: { requestId } });
const confirmed = (requestId: string) => ({
  ...params(requestId),
  body: { confirm: true as const },
});

const startExport = (fixture: Fixture, requestId: string, fail = false) =>
  withRights(
    fixture,
    (context, tx) => handlers.startRequestExport({ tx, context, input: params(requestId) }),
    fail,
  );

const startErasure = (fixture: Fixture, requestId: string) =>
  withRights(fixture, (context, tx) =>
    handlers.startRequestErasure({ tx, context, input: confirmed(requestId) }),
  );

const jobRequests = async (fixture: Fixture) =>
  (
    await as(fixture, fixture.member, (tx) =>
      tx
        .$extendTables<JobRequestTable>()
        .selectFrom('app.job_request')
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .executeTakeFirstOrThrow(),
    )
  ).result.count;

const jobOf = async (fixture: Fixture, requestId: string) =>
  (
    await as(fixture, fixture.member, (tx, context) =>
      handlers.getRightsRequest({ tx, context, input: params(requestId) }),
    )
  ).result;

describe('export from a request', () => {
  it('starts the export for the request subject and keeps the job request id', async () => {
    const requestId = await log(a);
    const before = started.length;

    const { result, events } = await startExport(a, requestId);

    expect(started.slice(before)).toEqual([{ kind: 'export', personId: a.person }]);
    expect(events).toEqual([
      {
        kind: 'record',
        action: 'privacy.rights_request.export_started',
        entityId: requestId,
        changes: { [COLUMN.export]: { after: result.requestId } },
        subject: a.person,
      },
    ]);
    expect((await jobOf(a, requestId)).exportRequestId).toBe(result.requestId);
  });

  it('allows a portability request, and refuses every other kind with a problem that echoes nothing', async () => {
    const portability = await log(a, { kind: 'portability' });
    const { result } = await startExport(a, portability);
    expect(result.requestId).toBeTruthy();

    for (const kind of ['erasure', 'rectification', 'complaint']) {
      const requestId = await log(a, { kind });
      const refused = await refusal(startExport(a, requestId));
      expect(refused.status).toBe(409);
      expect(refused.message).not.toContain(a.person);
      expect((await jobOf(a, requestId)).exportRequestId).toBeNull();
    }
  });

  it('refuses until the identity check passes, and accepts not needed', async () => {
    for (const identityCheck of ['not_started', 'requested', 'failed']) {
      const requestId = await log(a, { identityCheck });
      const before = started.length;
      expect((await refusal(startExport(a, requestId))).status).toBe(409);
      expect(started).toHaveLength(before);
    }
    const notNeeded = await log(a, { identityCheck: 'not_needed' });
    expect((await startExport(a, notNeeded)).result.requestId).toBeTruthy();
  });

  it('refuses a closed request', async () => {
    const requestId = await log(a);
    await as(a, a.member, (tx, context) =>
      handlers.closeRightsRequest({
        tx,
        context,
        input: { ...params(requestId), body: { on: today, reason: 'withdrawn' } },
      }),
    );
    const before = started.length;
    const refused = await refusal(startExport(a, requestId));
    expect(refused.status).toBe(409);
    expect(started).toHaveLength(before);
  });

  it('refuses a second export while the first is queued or running, and allows one once it ends', async () => {
    const requestId = await log(a);
    const first = (await startExport(a, requestId)).result.requestId;

    for (const status of ['queued', 'running'] as const) {
      jobs.set(first, { id: first, requestedAt: REQUESTED_AT, status });
      const refused = await refusal(startExport(a, requestId));
      expect(refused.status).toBe(409);
    }

    const ended = [
      { status: 'ready', fileId: randomUUID(), expiresAt: REQUESTED_AT },
      { status: 'failed', failureCode: 'job_failed' },
      { status: 'expired' },
    ] as const;
    let current = first;
    for (const end of ended) {
      jobs.set(current, { id: current, requestedAt: REQUESTED_AT, ...end });
      current = (await startExport(a, requestId)).result.requestId;
      expect(current).not.toBe(first);
    }
  });

  it('answers a replayed start with the first job request and starts and writes nothing', async () => {
    const requestId = await log(a);
    const first = (await startExport(a, requestId)).result.requestId;
    const before = started.length;

    const { result, events } = await as(a, a.member, (tx, context) =>
      handlers.replayStartRequestExport({ tx, context, input: params(requestId), id: null }),
    );

    expect(result).toEqual({ requestId: first });
    expect(started).toHaveLength(before);
    expect(events).toEqual([]);
  });

  it('leaves nothing behind when the platform fails', async () => {
    const requestId = await log(a);
    const before = await jobRequests(a);
    await expect(startExport(a, requestId, true)).rejects.toThrow('The platform is down.');
    expect((await jobOf(a, requestId)).exportRequestId).toBeNull();
    expect(await jobRequests(a)).toBe(before);
  });

  it('answers a missing request and another tenant request alike, and starts and writes nothing', async () => {
    const theirs = await log(b);
    const before = started.length;
    for (const requestId of [theirs, unknownId()]) {
      const refused = await refusal(startExport(a, requestId));
      expect(refused.status).toBe(404);
      expect(refused.message).not.toContain(requestId);
    }
    expect(started).toHaveLength(before);
    expect((await jobOf(b, theirs)).exportRequestId).toBeNull();
  });

  it('reads the status with a sensitive read, and answers 404 before an export or for another tenant', async () => {
    const requestId = await log(a);
    expect(
      (
        await refusal(
          withRights(a, (context, tx) =>
            handlers.getRequestExport({ tx, context, input: params(requestId) }),
          ),
        )
      ).status,
    ).toBe(404);

    const { result: job } = await startExport(a, requestId);
    const { result, events } = await withRights(a, (context, tx) =>
      handlers.getRequestExport({ tx, context, input: params(requestId) }),
    );
    expect(result).toMatchObject({ id: job.requestId, status: 'queued' });
    expect(events).toEqual([
      {
        kind: 'read',
        action: 'privacy.rights_request.export_viewed',
        entityId: requestId,
        subject: a.person,
      },
    ]);

    const theirs = await log(b);
    await startExport(b, theirs);
    const denied = withRights(a, (context, tx) =>
      handlers.getRequestExport({ tx, context, input: params(theirs) }),
    );
    expect((await refusal(denied)).status).toBe(404);
  });
});

describe('erasure from a request', () => {
  it('starts the erasure for the request subject and keeps the job request id', async () => {
    const requestId = await log(a, { kind: 'erasure' });
    const before = started.length;

    const { result, events } = await startErasure(a, requestId);

    expect(started.slice(before)).toEqual([{ kind: 'erasure', personId: a.person }]);
    expect(events).toEqual([
      {
        kind: 'record',
        action: 'privacy.rights_request.erasure_started',
        entityId: requestId,
        changes: { [COLUMN.erasure]: { after: result.requestId } },
        subject: a.person,
      },
    ]);
    expect((await jobOf(a, requestId)).erasureRequestId).toBe(result.requestId);
  });

  it('refuses another kind, an unverified identity and a closed request', async () => {
    const before = started.length;
    const wrongKind = await log(a, { kind: 'access' });
    const unverified = await log(a, { kind: 'erasure', identityCheck: 'requested' });
    const closed = await log(a, { kind: 'erasure' });
    await as(a, a.member, (tx, context) =>
      handlers.closeRightsRequest({
        tx,
        context,
        input: { ...params(closed), body: { on: today, reason: 'refused' } },
      }),
    );
    for (const requestId of [wrongKind, unverified, closed]) {
      const refused = await refusal(startErasure(a, requestId));
      expect(refused.status).toBe(409);
      expect(refused.message).not.toContain(a.person);
    }
    expect(started).toHaveLength(before);
  });

  it('refuses a second erasure while the first is running, and leaves a done one to the platform', async () => {
    const requestId = await log(a, { kind: 'erasure' });
    const first = (await startErasure(a, requestId)).result.requestId;
    expect((await refusal(startErasure(a, requestId))).status).toBe(409);

    jobs.set(first, {
      id: first,
      requestedAt: REQUESTED_AT,
      status: 'failed',
      failureCode: 'job_failed',
    });
    expect((await startErasure(a, requestId)).result.requestId).not.toBe(first);
  });

  it('answers a replayed start with the first job request and starts nothing', async () => {
    const requestId = await log(a, { kind: 'erasure' });
    const first = (await startErasure(a, requestId)).result.requestId;
    const before = started.length;
    const { result, events } = await as(a, a.member, (tx, context) =>
      handlers.replayStartRequestErasure({ tx, context, input: params(requestId), id: null }),
    );
    expect(result).toEqual({ requestId: first });
    expect(started).toHaveLength(before);
    expect(events).toEqual([]);
  });

  it('keeps the request, so it can still be closed after the erasure starts', async () => {
    const requestId = await log(a, { kind: 'erasure' });
    await startErasure(a, requestId);
    const { result } = await as(a, a.member, (tx, context) =>
      handlers.closeRightsRequest({
        tx,
        context,
        input: { ...params(requestId), body: { on: today, reason: 'completed' } },
      }),
    );
    expect(result.clock.state).toBe('closed');
    expect(result.erasureRequestId).not.toBeNull();
  });

  it("answers another tenant's request as a missing one, and reads status only for an erasure that started", async () => {
    const theirs = await log(b, { kind: 'erasure' });
    const before = started.length;
    expect((await refusal(startErasure(a, theirs))).status).toBe(404);
    expect(started).toHaveLength(before);

    const mine = await log(a, { kind: 'erasure' });
    const read = (fixture: Fixture, requestId: string) =>
      withRights(fixture, (context, tx) =>
        handlers.getRequestErasure({ tx, context, input: params(requestId) }),
      );
    expect((await refusal(read(a, mine))).status).toBe(404);

    const { result: job } = await startErasure(a, mine);
    expect((await read(a, mine)).result).toMatchObject({ id: job.requestId, status: 'queued' });
    expect((await refusal(read(b, mine))).status).toBe(404);
  });
});

describe('consent audit', () => {
  it("reads the person's history through party's contract with a sensitive read", async () => {
    const { result, events } = await withRights(a, (context, tx) =>
      handlers.getConsentHistory({ tx, context, input: { params: { personId: a.person } } }),
    );
    expect(result.entries).toHaveLength(1);
    expect(events).toEqual([
      {
        kind: 'read',
        action: 'privacy.consent_history.viewed',
        entityId: a.person,
        subject: a.person,
      },
    ]);
  });

  it('answers a missing person and another tenant person alike, writing nothing', async () => {
    for (const personId of [b.person, unknownId()]) {
      const refused = await refusal(
        withRights(a, (context, tx) =>
          handlers.getConsentHistory({ tx, context, input: { params: { personId } } }),
        ),
      );
      expect(refused.status).toBe(404);
      expect(refused.message).not.toContain(personId);
    }
  });
});
