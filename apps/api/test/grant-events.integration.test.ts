// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What grants publishes through the whole API against the test database, as
// app_api (ADR 0016, ADR 0034): an ids-only event for each submission and
// each release, in the request's transaction and nowhere else (architecture
// rules 6, 8 and 9). A stand-in crm subscribes, so each publish sends a job.

import { randomUUID } from 'node:crypto';

import { defineSubscriptions } from '@pixel-scientists/domain/events';
import type { Adjustment, AssistedApplication } from '@pixel-scientists/grants/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { asMigratorIn } from '../../../packages/db/test/tenants.ts';
import { complete, inDays } from './applications-api.ts';
import { accepted, startDecisionsApi, type DecisionsApi } from './decisions-api.ts';
import { answer } from './programme-api.ts';
import type { Member } from './settings-api.ts';

// Each request runs a few statements in a transaction, which is slow on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

const SUBMITTED = 'grants.application_submitted.v1';
const RELEASED = 'grants.decision_released.v1';

let t: DecisionsApi;

beforeAll(async () => {
  defineSubscriptions('crm', [SUBMITTED, RELEASED]);
  t = await startDecisionsApi('41111');
}, 60_000);

afterAll(async () => {
  await t.rows(`DELETE FROM pgboss.job WHERE name = 'events.crm' AND data->>'tenantId' = ANY($1)`, [
    [t.tenantA.id, t.tenantB.id],
  ]);
  await t.close();
});

interface Sent {
  data: {
    tenantId: string;
    requestId: string;
    causingUserId: string;
    event: { type: string; tenantId: string; causedBy: string; data: Record<string, string> };
  };
}

/** The crm jobs sent for an application's events, as the migrator sees the queue. */
const sent = (type: string, applicationId: string) =>
  t.rows<Sent>(
    `SELECT data FROM pgboss.job
      WHERE name = 'events.crm' AND data->'event'->>'type' = $1
        AND data->'event'->'data'->>'applicationId' = $2`,
    [type, applicationId],
  );

const personIdOf = async (member: Member) =>
  (
    await t.rows<{ id: string }>('SELECT id FROM party.person WHERE user_id = $1', [member.userId])
  )[0]?.id ?? '';

const partiesOf = (applicationId: string) =>
  t.rows<{ organisation_id: string; applicant_person_id: string }>(
    'SELECT organisation_id, applicant_person_id FROM grants.application WHERE id = $1',
    [applicationId],
  );

describe('submitting an application', () => {
  it('publishes one event from the stored rows, with ids, the route and the timing and nothing else', async () => {
    const email = `ada-${randomUUID()}@example.org`;
    await t.personOf(t.ann, 'Ada', email);
    const open = await t.openRound();
    const draft = await t.aDraft(t.ann, open.round.id);
    await answer(t.submit(t.ann, await t.saved(t.ann, draft, complete)));

    const jobs = await sent(SUBMITTED, draft.id);
    expect(jobs).toHaveLength(1);
    const { data } = jobs[0] as Sent;
    const [stored] = await partiesOf(draft.id);
    expect(data.event.data).toEqual({
      applicationId: draft.id,
      roundId: open.round.id,
      programmeId: open.programmeId,
      organisationId: stored?.organisation_id,
      applicantPersonId: stored?.applicant_person_id,
      route: 'portal',
      timing: 'on_time',
      submittedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) as string,
    });
    expect(data.tenantId).toBe(t.tenantA.id);
    expect(data.event).toMatchObject({ tenantId: t.tenantA.id, causedBy: t.ann.membershipId });
    const text = JSON.stringify(data);
    for (const secret of ['Ada', email, 'Northfield', 'Village hall roof']) {
      expect(text).not.toContain(secret);
    }
    // crm is off for the tenant, and the submission still succeeded.
    expect(
      await t.rows(`SELECT 1 FROM app.tenant_module WHERE module = 'crm' AND enabled`),
    ).toHaveLength(0);
  });

  it('maps a late submission to late, and one inside a live extension to on_time', async () => {
    const open = await t.openRound(t.managerA, undefined, {
      round: { latePolicy: 'accept_and_flag' },
    });
    const [late, extended] = [
      await t.aDraft(t.ann, open.round.id),
      await t.aDraft(t.ben, open.round.id),
    ];
    const ready = [
      await t.saved(t.ann, late, complete),
      await t.saved(t.ben, extended, complete),
    ] as const;
    await answer<Adjustment>(
      t.send(t.managerA, 'POST', `/console/rounds/${open.round.id}/adjustments`, {
        kind: 'deadline_extension',
        organisationId: extended.organisation.id,
        reasonCode: 'access_needs',
        closesAt: inDays(9),
      }),
      201,
    );
    await t.changeRound(open.round.id, "closes_at = now() - interval '1 hour'");
    await answer(t.submit(t.ann, ready[0]));
    await answer(t.submit(t.ben, ready[1]));

    expect((await sent(SUBMITTED, late.id))[0]?.data.event.data['timing']).toBe('late');
    expect((await sent(SUBMITTED, extended.id))[0]?.data.event.data['timing']).toBe('on_time');
  });

  it('sends nothing for a submission that is refused', async () => {
    const open = await t.openRound();
    const draft = await t.aDraft(t.ann, open.round.id);
    await t.saved(t.ann, draft, complete);
    expect((await t.submit(t.ann, { ...draft, answersVersion: 99 })).statusCode).toBe(409);
    const reviewer = await t.send(t.grace, 'POST', t.path(draft.id, '/submit'), { basedOn: 2 });
    expect(reviewer.statusCode).toBe(403);
    expect(await sent(SUBMITTED, draft.id)).toHaveLength(0);
  });
});

describe('submitting for the applicant', () => {
  const asStaff = (method: 'POST' | 'PUT', url: string, payload: unknown) =>
    t.send(t.managerA, method, url, payload, 'console', new Date());

  async function ready() {
    const open = await t.openRound();
    const organisationId = await t.organisationOf(t.ann);
    await answer<Adjustment>(
      t.send(t.managerA, 'POST', `/console/rounds/${open.round.id}/adjustments`, {
        kind: 'alternative_route',
        organisationId,
        reasonCode: 'access_needs',
      }),
      201,
    );
    const draft = await answer<AssistedApplication>(
      asStaff('POST', `/console/rounds/${open.round.id}/assisted-applications`, {
        organisationId,
        contactPersonId: await personIdOf(t.ann),
      }),
      201,
    );
    const saved = await answer<{ answersVersion: number }>(
      asStaff('PUT', `/console/assisted-applications/${draft.id}/answers`, {
        basedOn: draft.answersVersion,
        answers: complete,
      }),
    );
    const submit = () =>
      asStaff('POST', `/console/assisted-applications/${draft.id}/submit`, {
        basedOn: saved.answersVersion,
      });
    return { draft, submit };
  }

  it('publishes with the assisted route, caused by the staff member', async () => {
    const { draft, submit } = await ready();
    await answer(submit());

    const jobs = await sent(SUBMITTED, draft.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data.event.data['route']).toBe('assisted');
    expect(jobs[0]?.data.event.causedBy).toBe(t.managerA.membershipId);
  });

  it('leaves neither the submission nor a job when a later step in the transaction fails', async () => {
    const { draft, submit } = await ready();
    await asMigratorIn(t.tenantA.id, async (client) => {
      await client.query(`CREATE FUNCTION public.fail_on_behalf() RETURNS trigger LANGUAGE plpgsql
        AS $$ BEGIN RAISE EXCEPTION 'forced'; END $$`);
      await client.query(`CREATE TRIGGER fail_on_behalf AFTER INSERT ON app.audit_event
        FOR EACH ROW WHEN (NEW.action = 'grants.application.submitted_on_behalf')
        EXECUTE FUNCTION public.fail_on_behalf()`);
    });
    let response;
    try {
      response = await submit();
    } finally {
      await asMigratorIn(t.tenantA.id, async (client) => {
        await client.query('DROP TRIGGER fail_on_behalf ON app.audit_event');
        await client.query('DROP FUNCTION public.fail_on_behalf()');
      });
    }

    expect(response.statusCode).toBe(500);
    const [row] = await t.rows<{ status: string }>(
      'SELECT status FROM grants.application WHERE id = $1',
      [draft.id],
    );
    expect(row?.status).toBe('draft');
    expect(await sent(SUBMITTED, draft.id)).toHaveLength(0);
  });
});

describe('releasing decisions', () => {
  async function aRound() {
    const round = await t.reviewRound();
    const [a, b] = [await t.submission(round), await t.submission(round)];
    return { roundId: round.open.round.id, a, b };
  }

  it('publishes nothing when an outcome is recorded, and one event per decision when it is released', async () => {
    const { roundId, a, b } = await aRound();
    await t.recorded(a, accepted(12_345));
    await t.recorded(b, accepted(20_000));
    expect(await sent(RELEASED, a)).toHaveLength(0);
    expect(await sent(RELEASED, b)).toHaveLength(0);

    await answer(t.release(roundId));
    const jobs = await sent(RELEASED, a);
    expect(jobs).toHaveLength(1);
    expect(await sent(RELEASED, b)).toHaveLength(1);
    const [row] = await t.decisions<{ id: string; released_at: Date }>('d.application_id = $1', [
      a,
    ]);
    const [stored] = await partiesOf(a);
    expect(jobs[0]?.data.event.data).toEqual({
      decisionId: row?.id,
      applicationId: a,
      roundId,
      organisationId: stored?.organisation_id,
      recipientPersonId: stored?.applicant_person_id,
      releasedAt: row?.released_at.toISOString(),
    });
    expect(jobs[0]?.data.event.causedBy).toBe(t.managerA.membershipId);
    expect(JSON.stringify(jobs[0]?.data)).not.toMatch(/accepted|1234500|12345|2000000|20000/);
  });

  it('publishes nothing again for a resend of the release emails', async () => {
    const { roundId, a } = await aRound();
    await t.recorded(a, accepted());
    await answer(t.release(roundId));
    await answer(t.resend(roundId));
    expect(await sent(RELEASED, a)).toHaveLength(1);
  });

  it('is refused without a recent sign-in or the permission, and publishes nothing', async () => {
    const { roundId, a } = await aRound();
    await t.recorded(a, accepted());
    const stale = await t.send(t.managerA, 'POST', t.roundPath(roundId, '/release'), {
      release: 'all',
    });
    const reviewer = await t.release(roundId, { release: 'all' }, t.grace);
    expect(stale.statusCode).toBe(403);
    expect(reviewer.statusCode).toBe(403);
    expect(await sent(RELEASED, a)).toHaveLength(0);
  });
});

describe('between tenants', () => {
  it('sends a tenant its own jobs only, even when the other tenant submits as well', async () => {
    const openA = await t.openRound();
    const openB = await t.openRound(t.managerB);
    const draftA = await t.aDraft(t.ann, openA.round.id);
    const draftB = await t.aDraft(t.cat, openB.round.id);
    await answer(t.submit(t.ann, await t.saved(t.ann, draftA, complete)));
    await answer(t.submit(t.cat, await t.saved(t.cat, draftB, complete)));

    const [jobA, jobB] = [await sent(SUBMITTED, draftA.id), await sent(SUBMITTED, draftB.id)];
    expect(jobA.map((job) => job.data.tenantId)).toEqual([t.tenantA.id]);
    expect(jobB.map((job) => job.data.tenantId)).toEqual([t.tenantB.id]);
    expect(jobB[0]?.data.event.data['roundId']).toBe(openB.round.id);
    expect(JSON.stringify(jobA)).not.toContain(draftB.id);
  });
});
