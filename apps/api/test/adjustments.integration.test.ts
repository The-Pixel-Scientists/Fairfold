// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Reasonable adjustments through the whole API against the test database, as
// app_api, for two tenants: who may grant and remove them, what they leave in
// the tables and the audit log (never the reason code), and what a deadline
// extension does to starting and submitting.

import { randomUUID } from 'node:crypto';

import type {
  Adjustment,
  AdjustmentList,
  Application,
  SubmissionAdjustments,
} from '@pixel-scientists/grants/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { asMigratorIn } from '../../../packages/db/test/tenants.ts';
import {
  complete,
  inDays,
  startApplicationsApi,
  type ApplicationsApi,
} from './applications-api.ts';
import { answer, type Problem } from './programme-api.ts';
import { switchModule } from './modules-on.ts';
import { events } from './settings-api.ts';
import { expectLooksMissing } from './support.ts';

// Each request runs a few statements in a transaction, which is slow on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

let t: ApplicationsApi;

beforeAll(async () => {
  t = await startApplicationsApi('41080');
}, 60_000);

afterAll(async () => {
  await t.close();
});

const roundPath = (roundId: string) => `/console/rounds/${roundId}/adjustments`;
const revokePath = (id: string) => `/console/adjustments/${id}/revoke`;

const extension = (organisationId: string, closesAt = inDays(9), change: object = {}) => ({
  kind: 'deadline_extension',
  organisationId,
  reasonCode: 'access_needs',
  closesAt,
  ...change,
});

const grant = (roundId: string, body: object, member = t.managerA, key?: string) =>
  t.send(member, 'POST', roundPath(roundId), body, 'console', null, key);

const adjustmentRows = (roundId: string) =>
  t.rows<{ id: string; granted_by: string; revoked_by: string | null; closes_at: Date | null }>(
    'SELECT id, granted_by, revoked_by, closes_at FROM grants.adjustment WHERE round_id = $1 ORDER BY granted_at, id',
    [roundId],
  );

/** An extension that ended an hour ago, which the route would refuse, as time passing leaves one. */
async function expiredExtension(roundId: string, organisationId: string) {
  await t.changeRound(roundId, "closes_at = now() - interval '3 days'");
  await asMigratorIn(t.tenantA.id, (client) =>
    client.query(
      `INSERT INTO grants.adjustment
         (tenant_id, round_id, organisation_id, kind, closes_at, reason_code, granted_by)
       VALUES ($1, $2, $3, 'deadline_extension', now() - interval '1 hour', 'other', $4)`,
      [t.tenantA.id, roundId, organisationId, t.managerA.membershipId],
    ),
  );
}

describe('granting an adjustment', () => {
  it('grants one as the session’s member with the database’s time, and audits ids and the kind only', async () => {
    const open = await t.openRound();
    const organisationId = await t.organisationOf(t.ann);
    const granted = await answer<Adjustment>(grant(open.round.id, extension(organisationId)), 201);

    expect(granted).toMatchObject({
      roundId: open.round.id,
      organisation: { id: organisationId },
      kind: 'deadline_extension',
      reasonCode: 'access_needs',
      grantedBy: { membershipId: t.managerA.membershipId },
      revoked: null,
    });
    const [row] = await adjustmentRows(open.round.id);
    expect(row).toMatchObject({ id: granted.id, granted_by: t.managerA.membershipId });

    const [event] = (await events(t.tenantA, 'grants.adjustment.granted')).filter(
      ({ entity_id }) => entity_id === granted.id,
    );
    expect(event?.actor_id).toBe(t.managerA.membershipId);
    expect(JSON.stringify(event?.changes)).not.toMatch(/access_needs|reason/);
  });

  it('is idempotent: the same key makes one adjustment and answers the same one', async () => {
    const open = await t.openRound();
    const organisationId = await t.organisationOf(t.ann);
    const key = randomUUID();
    const first = await answer<Adjustment>(
      grant(open.round.id, extension(organisationId), t.managerA, key),
      201,
    );
    const again = await answer<Adjustment>(
      grant(open.round.id, extension(organisationId), t.managerA, key),
      201,
    );

    expect(again.id).toBe(first.id);
    expect(await adjustmentRows(open.round.id)).toHaveLength(1);
  });

  it('refuses a body naming a member, a closing time before the round’s or passed, and a missing application, without echoing them', async () => {
    const open = await t.openRound();
    const organisationId = await t.organisationOf(t.ann);
    const refusals = [
      grant(open.round.id, { ...extension(organisationId), grantedBy: t.ada.membershipId }),
      grant(open.round.id, extension(organisationId, inDays(-1))),
      grant(open.round.id, extension(organisationId, inDays(3))),
      grant(open.round.id, extension(organisationId, inDays(9), { reasonCode: 'a secret' })),
      grant(open.round.id, extension(organisationId, inDays(9), { applicationId: randomUUID() })),
    ];
    const answers = await Promise.all(refusals);
    expect(answers.map((response) => response.statusCode)).toEqual([400, 400, 400, 400, 400]);
    for (const response of answers) {
      expect(response.body).not.toMatch(/a secret|access_needs/);
    }
    expect(answers[2]?.json<Problem>().errors?.map(({ field }) => field)).toEqual([
      'body.closesAt',
    ]);
    expect(await adjustmentRows(open.round.id)).toHaveLength(0);
  });

  it('names an application only for an extension, and only the organisation’s own', async () => {
    const open = await t.openRound();
    const draft = await t.aDraft(t.ann, open.round.id);
    const other = await t.organisationOf(t.ben, 'Southfield Gardeners');

    const own = await grant(
      open.round.id,
      extension(draft.organisation.id, inDays(9), { applicationId: draft.id }),
    );
    expect(own.statusCode).toBe(201);
    const notTheirs = await grant(
      open.round.id,
      extension(other, inDays(9), { applicationId: draft.id }),
    );
    expect(notTheirs.statusCode).toBe(400);
    const route = await grant(open.round.id, {
      kind: 'alternative_route',
      organisationId: other,
      reasonCode: 'other',
      applicationId: draft.id,
    });
    expect(route.statusCode).toBe(400);
  });

  it('is for programme managers: a reviewer, an applicant and a signed-out caller are refused', async () => {
    const open = await t.openRound();
    const organisationId = await t.organisationOf(t.ann);
    const body = extension(organisationId);

    expect((await grant(open.round.id, body, t.reviewerA)).statusCode).toBe(403);
    expect(
      (await t.send(t.ann, 'POST', roundPath(open.round.id), body, 'console')).statusCode,
    ).toBe(403);
    expect((await t.send(undefined, 'POST', roundPath(open.round.id), body)).statusCode).toBe(401);
    expect(await adjustmentRows(open.round.id)).toHaveLength(0);
  });

  it('answers another tenant’s round, organisation and adjustment as missing, and writes nothing', async () => {
    const open = await t.openRound();
    const organisationId = await t.organisationOf(t.ann);
    const granted = await answer<Adjustment>(grant(open.round.id, extension(organisationId)), 201);
    const theirs = await t.openRound(t.managerB);
    const theirOrganisation = await t.organisationOf(t.cat);

    const unknown = await grant(randomUUID(), extension(organisationId), t.managerB);
    expectLooksMissing(await grant(open.round.id, extension(organisationId), t.managerB), unknown);
    expectLooksMissing(
      await grant(theirs.round.id, extension(organisationId), t.managerB),
      unknown,
    );
    expectLooksMissing(
      await grant(open.round.id, extension(theirOrganisation), t.managerA),
      unknown,
    );
    const missingList = await t.send(t.managerB, 'GET', roundPath(randomUUID()));
    expectLooksMissing(await t.send(t.managerB, 'GET', roundPath(open.round.id)), missingList);
    const missingRevoke = await t.send(t.managerB, 'POST', revokePath(randomUUID()), {
      reasonCode: 'other',
    });
    expectLooksMissing(
      await t.send(t.managerB, 'POST', revokePath(granted.id), { reasonCode: 'other' }),
      missingRevoke,
    );

    expect(await adjustmentRows(open.round.id)).toHaveLength(1);
    expect((await adjustmentRows(open.round.id))[0]?.revoked_by).toBeNull();
    expect(await adjustmentRows(theirs.round.id)).toHaveLength(0);
  });
});

describe('removing an adjustment', () => {
  it('removes it once, as the session’s member, and audits ids and the kind only', async () => {
    const open = await t.openRound();
    const organisationId = await t.organisationOf(t.ann);
    const granted = await answer<Adjustment>(grant(open.round.id, extension(organisationId)), 201);

    const removed = await answer<Adjustment>(
      t.send(t.ada, 'POST', revokePath(granted.id), { reasonCode: 'applicant_asked' }),
    );
    expect(removed.revoked).toMatchObject({
      by: { membershipId: t.ada.membershipId },
      reasonCode: 'applicant_asked',
    });
    const [row] = await adjustmentRows(open.round.id);
    expect(row?.revoked_by).toBe(t.ada.membershipId);

    const again = await t.send(t.managerA, 'POST', revokePath(granted.id), { reasonCode: 'other' });
    expect(again.statusCode).toBe(409);
    expect((await t.send(t.managerA, 'POST', revokePath(granted.id), { by: 'x' })).statusCode).toBe(
      400,
    );

    const [event] = (await events(t.tenantA, 'grants.adjustment.revoked')).filter(
      ({ entity_id }) => entity_id === granted.id,
    );
    expect(event?.actor_id).toBe(t.ada.membershipId);
    expect(JSON.stringify(event?.changes)).not.toMatch(/access_needs|applicant_asked|reason/);
    expect(
      (await t.send(t.reviewerA, 'POST', revokePath(granted.id), { reasonCode: 'other' }))
        .statusCode,
    ).toBe(403);
  });

  it('lists a round’s adjustments, removed ones included, and a submission’s with when it closes', async () => {
    const open = await t.openRound(t.managerA, undefined, {
      round: { latePolicy: 'accept_and_flag' },
    });
    const draft = await t.aDraft(t.ann, open.round.id);
    const first = await answer<Adjustment>(
      grant(open.round.id, extension(draft.organisation.id, inDays(9))),
      201,
    );
    await answer(t.send(t.managerA, 'POST', revokePath(first.id), { reasonCode: 'other' }));
    const second = await answer<Adjustment>(
      grant(open.round.id, extension(draft.organisation.id, inDays(12))),
      201,
    );

    const { adjustments } = await answer<AdjustmentList>(
      t.send(t.managerA, 'GET', roundPath(open.round.id)),
    );
    expect(adjustments.map(({ id }) => id)).toEqual([second.id, first.id]);

    const missing = await t.send(t.managerA, 'GET', `/console/submissions/${draft.id}/adjustments`);
    expect(missing.statusCode).toBe(404);
    await answer(t.submit(t.ann, await t.saved(t.ann, draft, complete)));
    const forSubmission = await answer<SubmissionAdjustments>(
      t.send(t.managerA, 'GET', `/console/submissions/${draft.id}/adjustments`),
    );
    expect(forSubmission.adjustments.map(({ id }) => id)).toEqual([second.id, first.id]);
    expect(forSubmission.closesAt).toBe(second.closesAt);
  });
});

describe('a deadline extension', () => {
  const closeRound = (roundId: string) =>
    t.changeRound(roundId, "closes_at = now() - interval '1 hour'");
  const submitted = async (applicationId: string) =>
    (
      await t.rows<{ status: string; late: boolean }>(
        'SELECT status, submitted_late AS late FROM grants.application WHERE id = $1',
        [applicationId],
      )
    )[0];

  it('lets an organisation start, save and submit after the round’s closing time, on time', async () => {
    const open = await t.openRound(t.managerA, undefined, { round: { latePolicy: 'refuse' } });
    const organisationId = await t.organisationOf(t.ann);
    await closeRound(open.round.id);

    expect((await t.send(t.ann, 'GET', `/portal/rounds/${open.round.id}`)).statusCode).toBe(404);
    expect(
      (await t.send(t.ann, 'POST', t.startPath(open.round.id), { organisationId })).statusCode,
    ).toBe(404);

    // Another organisation's extension admits nothing for this one.
    const other = await t.organisationOf(t.ben, 'Southfield Gardeners');
    await answer(grant(open.round.id, extension(other, inDays(2))), 201);
    expect(
      (await t.send(t.ann, 'POST', t.startPath(open.round.id), { organisationId })).statusCode,
    ).toBe(404);

    await answer(grant(open.round.id, extension(organisationId, inDays(2))), 201);
    expect((await t.send(t.ann, 'GET', `/portal/rounds/${open.round.id}`)).statusCode).toBe(200);
    const draft = await answer<Application>(
      t.send(t.ann, 'POST', t.startPath(open.round.id), { organisationId }),
      201,
    );
    const ready = await t.saved(t.ann, draft, complete);
    await answer(t.submit(t.ann, ready));
    expect(await submitted(draft.id)).toEqual({ status: 'submitted', late: false });
  });

  it('marks a submission late once the extension has ended, and refuses it under the refuse policy', async () => {
    for (const latePolicy of ['accept_and_flag', 'refuse'] as const) {
      const open = await t.openRound(t.managerA, undefined, { round: { latePolicy } });
      const draft = await t.aDraft(t.ann, open.round.id);
      const ready = await t.saved(t.ann, draft, complete);
      await expiredExtension(open.round.id, draft.organisation.id);

      const response = await t.submit(t.ann, ready);
      if (latePolicy === 'refuse') {
        expect(response.statusCode).toBe(400);
        expect((await submitted(draft.id))?.status).toBe('draft');
      } else {
        expect(response.statusCode).toBe(200);
        expect(await submitted(draft.id)).toEqual({ status: 'submitted', late: true });
      }
    }
  });

  it('ignores a removed extension, and uses the latest of two that overlap', async () => {
    const open = await t.openRound(t.managerA, undefined, {
      round: { latePolicy: 'accept_and_flag' },
    });
    const removedFor = await t.aDraft(t.ann, open.round.id);
    const overlapFor = await t.aDraft(t.ben, open.round.id);
    const readyRemoved = await t.saved(t.ann, removedFor, complete);
    const readyOverlap = await t.saved(t.ben, overlapFor, complete);
    const removed = await answer<Adjustment>(
      grant(open.round.id, extension(removedFor.organisation.id, inDays(9))),
      201,
    );
    await answer(t.send(t.managerA, 'POST', revokePath(removed.id), { reasonCode: 'other' }));
    await answer(grant(open.round.id, extension(overlapFor.organisation.id, inDays(8))), 201);
    await answer(grant(open.round.id, extension(overlapFor.organisation.id, inDays(10))), 201);
    await closeRound(open.round.id);

    await answer(t.submit(t.ann, readyRemoved));
    await answer(t.submit(t.ben, readyOverlap));
    expect(await submitted(removedFor.id)).toEqual({ status: 'submitted', late: true });
    expect(await submitted(overlapFor.id)).toEqual({ status: 'submitted', late: false });
  });

  it('shows the applicant when they close and nothing else about it', async () => {
    const open = await t.openRound();
    const draft = await t.aDraft(t.ann, open.round.id);
    const granted = await answer<Adjustment>(
      grant(open.round.id, extension(draft.organisation.id, inDays(9))),
      201,
    );

    const response = await t.send(t.ann, 'GET', t.path(draft.id));
    const view = response.json<Application>();
    expect(view.closesAt).toBe(granted.closesAt);
    expect(view.round.closesAt).not.toBe(granted.closesAt);
    expect(response.body).not.toMatch(
      /kind|reason|access_needs|grantedBy|deadline_extension|membership/i,
    );
  });
});

describe('with grants switched off', () => {
  it('answers 404 on every new route, and writes nothing', async () => {
    const open = await t.openRound();
    const organisationId = await t.organisationOf(t.ann);
    const draft = await t.aDraft(t.ben, open.round.id);
    const granted = await answer<Adjustment>(grant(open.round.id, extension(organisationId)), 201);
    await answer(t.submit(t.ben, await t.saved(t.ben, draft, complete)));
    const requests = [
      ['GET', roundPath(open.round.id), undefined, t.managerA],
      ['GET', `/console/submissions/${draft.id}/adjustments`, undefined, t.managerA],
      ['POST', roundPath(open.round.id), extension(organisationId), t.managerA],
      ['POST', revokePath(granted.id), { reasonCode: 'other' }, t.managerA],
      ['GET', `/console/rounds/${open.round.id}/assisted-applications`, undefined, t.managerA],
    ] as const;
    const on = await Promise.all(
      requests.map(([method, url, body, member]) =>
        t.send(member, method, url, body, member.app, new Date()),
      ),
    );
    expect(on.map((response) => response.statusCode)).not.toContain(404);

    const before = await adjustmentRows(open.round.id);
    await switchModule(t.tenantA, 'grants', false);
    try {
      for (const [method, url, body, member] of requests) {
        const response = await t.send(member, method, url, body, member.app, new Date());
        expect(response.statusCode, `${method} ${url}`).toBe(404);
      }
    } finally {
      await switchModule(t.tenantA, 'grants', true);
    }
    expect(await adjustmentRows(open.round.id)).toEqual(before);
  });
});
