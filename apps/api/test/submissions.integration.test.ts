// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The staff submission routes through the whole API against the test
// database, as app_api, for two tenants: who may list, read and move
// submissions, what staff are shown, and that a move is all or nothing and
// leaves its history and audit events behind.

import { randomUUID } from 'node:crypto';

import type {
  StageMoveResult,
  Submission,
  SubmissionPage,
} from '@pixel-scientists/grants/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { asMigratorIn } from '../../../packages/db/test/tenants.ts';
import { complete, startApplicationsApi, type ApplicationsApi } from './applications-api.ts';
import { answer, type Method, type Problem } from './programme-api.ts';
import { events, type Member } from './settings-api.ts';
import { expectLooksMissing } from './support.ts';

// Each request runs a few statements in a transaction, which is slow on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

let t: ApplicationsApi;

beforeAll(async () => {
  t = await startApplicationsApi('41032');
}, 60_000);

afterAll(async () => {
  await t.close();
});

/** An answer to an aggregate-only question, which no staff response may carry. */
const TURNOVER = 7_654_321;

const listPath = (query = '') => `/console/submissions${query}`;
const detailPath = (id: string) => `/console/submissions/${id}`;
const movePath = (stageId: string) => `/console/stages/${stageId}/submissions`;

const list = (query = '', member = t.managerA) =>
  answer<SubmissionPage>(t.send(member, 'GET', listPath(query)));
const read = (id: string, member = t.managerA) =>
  answer<Submission>(t.send(member, 'GET', detailPath(id)));
const move = (stageId: string, submissionIds: string[], member = t.managerA) =>
  t.send(member, 'POST', movePath(stageId), { submissionIds });

type Open = Awaited<ReturnType<typeof t.openRound>>;

/** A round with its stages: intake, review and decision. */
async function aRound(change: { round?: object } = {}) {
  const open = await t.openRound(t.managerA, undefined, change);
  const [intake, review] = await t.stagesOf(open.round.id);
  if (intake === undefined || review === undefined) throw new Error('The round has no stages.');
  return { open, intake, review };
}

/** A draft with answers saved, ready to submit. */
async function ready(round: Open, member: Member = t.ann) {
  const draft = await t.aDraft(member, round.round.id);
  return t.saved(member, draft, { ...complete, f_turnover: TURNOVER });
}

async function submitted(round: Open, member: Member = t.ann): Promise<string> {
  const application = await ready(round, member);
  await answer(t.submit(member, application));
  return application.id;
}

const stageOf = async (id: string) =>
  (
    await t.rows<{ stage_id: string }>('SELECT stage_id FROM grants.application WHERE id = $1', [
      id,
    ])
  )[0]?.stage_id;

describe('listing submissions', () => {
  it('shows submitted and withdrawn applications, latest first, and never a draft', async () => {
    const { open, intake } = await aRound();
    const first = await submitted(open);
    const second = await submitted(open);
    const withdrawn = await submitted(open);
    await answer(t.send(t.ann, 'POST', t.path(withdrawn, '/withdraw')));
    const draft = await t.aDraft(t.ann, open.round.id);

    const page = await list(`?roundId=${open.round.id}`);
    expect(page.total).toBe(3);
    expect(page.nextCursor).toBeNull();
    expect(page.submissions.map(({ id }) => id)).toEqual(
      expect.arrayContaining([first, second, withdrawn]),
    );
    expect(page.submissions.map(({ id }) => id).indexOf(second)).toBeLessThan(
      page.submissions.map(({ id }) => id).indexOf(first),
    );
    expect(page.submissions.find(({ id }) => id === first)).toEqual({
      id: first,
      programme: { id: open.programmeId, title: 'Community Spaces Fund' },
      round: { id: open.round.id, title: 'Autumn 2026' },
      stage: { id: intake.id, name: 'Intake' },
      organisation: { id: expect.any(String) as string, name: 'Northfield Allotment Society' },
      status: 'submitted',
      submittedAt: expect.stringMatching(/Z$/) as string,
      late: false,
      eligibility: null,
    });

    for (const status of ['draft', 'incomplete']) {
      expect((await t.send(t.managerA, 'GET', listPath(`?status=${status}`))).statusCode).toBe(400);
    }
    expect(JSON.stringify(await list())).not.toContain(draft.id);
  });

  it('filters by programme, round, stage, status, lateness and latest eligibility', async () => {
    const { open, intake, review } = await aRound();
    const other = await aRound({ round: { latePolicy: 'accept_and_flag' } });
    const a = await submitted(open);
    const b = await submitted(open);
    const late = await ready(other.open);
    await t.changeRound(other.open.round.id, "closes_at = now() - interval '1 hour'");
    await answer(t.submit(t.ann, late));
    await answer(t.send(t.ann, 'POST', t.path(b, '/withdraw')));
    await answer<StageMoveResult>(move(review.id, [a]));
    const check = (id: string, outcome: string) =>
      t.rows(
        `INSERT INTO grants.eligibility_result
           (tenant_id, application_id, form_version_id, outcome, stopping_field_id, checked_by)
         SELECT tenant_id, id, form_version_id, $2, $3, created_by FROM grants.application
          WHERE id = $1 RETURNING id`,
        [id, outcome, outcome === 'stopped' ? 'f_charity' : null],
      );
    await check(a, 'stopped');
    await check(a, 'eligible');
    await check(b, 'stopped');

    const ids = async (query: string) => (await list(query)).submissions.map(({ id }) => id).sort();
    const round = `roundId=${open.round.id}`;
    expect(await ids(`?programmeId=${open.programmeId}`)).toEqual([a, b].sort());
    expect(await ids(`?${round}&stageId=${intake.id}`)).toEqual([b]);
    expect(await ids(`?${round}&stageId=${review.id}`)).toEqual([a]);
    expect(await ids(`?${round}&status=withdrawn`)).toEqual([b]);
    expect(await ids(`?${round}&eligibility=eligible`)).toEqual([a]);
    expect(await ids(`?${round}&eligibility=stopped`)).toEqual([b]);
    expect(await ids(`?roundId=${other.open.round.id}&late=true`)).toEqual([late.id]);
    expect(await ids(`?${round}&late=true`)).toEqual([]);
    expect(await ids(`?${round}&late=false`)).toEqual([a, b].sort());
    expect((await list(`?${round}&eligibility=eligible`)).total).toBe(1);
  });

  it('refuses answer fields, sorting and unknown keys', async () => {
    for (const query of ['?f_title=x', '?sort=organisation', '?search=Northfield', '?answers=x']) {
      expect((await t.send(t.managerA, 'GET', listPath(query))).statusCode, query).toBe(400);
    }
  });

  it('pages with a cursor, without gaps or repeats when submissions share a time', async () => {
    const { open } = await aRound();
    const original = await submitted(open);
    // Withdrawn copies at the same time, which the unique index on live applications allows.
    await t.rows(
      `INSERT INTO grants.application
         (tenant_id, round_id, form_version_id, applicant_person_id, organisation_id, status,
          stage_id, submitted_at, withdrawn_at, created_by, updated_by)
       SELECT tenant_id, round_id, form_version_id, applicant_person_id, organisation_id,
              'withdrawn', stage_id, submitted_at, submitted_at, created_by, updated_by
         FROM grants.application, generate_series(1, 54) WHERE id = $1 RETURNING id`,
      [original],
    );

    const first = await list(`?roundId=${open.round.id}`);
    expect(first.total).toBe(55);
    expect(first.submissions).toHaveLength(50);
    expect(first.nextCursor).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const second = await list(`?roundId=${open.round.id}&cursor=${first.nextCursor}`);
    expect(second.submissions).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    const ids = [...first.submissions, ...second.submissions].map(({ id }) => id);
    expect(new Set(ids).size).toBe(55);
    expect(ids).toEqual([...ids].sort((x, y) => (x < y ? 1 : -1)));
  });

  it('refuses a cursor that names no submission, a draft or another tenant’s included', async () => {
    const { open } = await aRound();
    const draft = await t.aDraft(t.ann, open.round.id);
    const cursor = (id: string) => Buffer.from(id.replaceAll('-', ''), 'hex').toString('base64url');
    for (const id of [randomUUID(), draft.id]) {
      const response = await t.send(t.managerA, 'GET', listPath(`?cursor=${cursor(id)}`));
      expect(response.statusCode).toBe(400);
    }
    const mine = await submitted(open);
    const outside = await t.send(t.managerB, 'GET', listPath(`?cursor=${cursor(mine)}`));
    expect(outside.statusCode).toBe(400);
  });
});

describe('reading a submission', () => {
  it('shows answers for staff, the organisation, contact, checks and history, and audits the read', async () => {
    const { open, intake, review } = await aRound();
    const application = await ready(open);
    await answer(t.send(t.ann, 'POST', t.path(application.id, '/eligibility-check')));
    await answer(t.submit(t.ann, application));
    await answer<StageMoveResult>(move(review.id, [application.id], t.ada));
    await t.rows(
      `INSERT INTO grants.eligibility_result
         (tenant_id, application_id, form_version_id, outcome, stopping_field_id, checked_by)
       SELECT tenant_id, id, form_version_id, 'stopped', 'f_charity', created_by
         FROM grants.application WHERE id = $1 RETURNING id`,
      [application.id],
    );
    await answer(t.send(t.ann, 'POST', t.path(application.id, '/withdraw')));

    const before = (await events(t.tenantA, 'grants.application.viewed')).length;
    const submission = await read(application.id);
    expect(submission).toMatchObject({
      id: application.id,
      status: 'withdrawn',
      stage: { id: review.id, name: 'Review' },
      form: { id: open.versionId, version: 1 },
      organisation: {
        id: application.organisation.id,
        name: 'Northfield Allotment Society',
        legalForm: 'community_benefit_society',
        identifiers: [{ scheme: 'GB-CHC', identifier: '1234567', verified: false }],
      },
      contact: { givenName: null, familyName: null, email: expect.stringContaining('@') as string },
      eligibility: 'stopped',
    });
    expect(submission.withdrawnAt).not.toBeNull();
    expect(submission.answers).toEqual({
      f_charity: true,
      f_title: 'Village hall roof',
      f_haveweb: false,
    });
    expect(submission.eligibilityChecks.map(({ outcome, fieldId }) => [outcome, fieldId])).toEqual([
      ['stopped', 'f_charity'],
      ['eligible', null],
    ]);
    expect(submission.history.map(({ event }) => event)).toEqual([
      'submitted',
      'stage_changed',
      'stage_changed',
      'withdrawn',
    ]);
    expect(submission.history[1]).toMatchObject({
      by: null,
      from: null,
      to: { id: intake.id, name: 'Intake' },
    });
    expect(submission.history[2]).toMatchObject({
      by: 'Ada Lovelace',
      from: { id: intake.id, name: 'Intake' },
      to: { id: review.id, name: 'Review' },
    });

    const viewed = await events(t.tenantA, 'grants.application.viewed');
    expect(viewed).toHaveLength(before + 1);
    expect(viewed.at(-1)).toMatchObject({
      entity_id: application.id,
      actor_id: t.managerA.membershipId,
    });
  });

  it('never sends an aggregate-only answer, in the list, the submission or a move', async () => {
    const { open, review } = await aRound();
    const id = await submitted(open);
    const bodies = [
      JSON.stringify(await list(`?roundId=${open.round.id}`)),
      JSON.stringify(await read(id)),
      (await move(review.id, [id])).body,
    ];
    for (const body of bodies) expect(body).not.toContain(String(TURNOVER));
    // The pinned answers do hold it.
    const [stored] = await t.rows<{ answers: object }>(
      'SELECT answers FROM grants.application WHERE id = $1',
      [id],
    );
    expect(stored?.answers).toMatchObject({ f_turnover: TURNOVER });
  });

  it('answers 404 for a draft, for nothing, and for another tenant’s submission, and audits none', async () => {
    const { open } = await aRound();
    const draft = await t.aDraft(t.ann, open.round.id);
    const mine = await submitted(open);
    const before = (await events(t.tenantA, 'grants.application.viewed')).length;

    const missing = await t.send(t.managerA, 'GET', detailPath(randomUUID()));
    expectLooksMissing(await t.send(t.managerA, 'GET', detailPath(draft.id)), missing);
    expectLooksMissing(
      await t.send(t.managerB, 'GET', detailPath(mine)),
      await t.send(t.managerB, 'GET', detailPath(randomUUID())),
    );
    expect(await events(t.tenantA, 'grants.application.viewed')).toHaveLength(before);
  });

  it('lists nothing of tenant A for tenant B', async () => {
    const { open } = await aRound();
    await submitted(open);
    expect(await list(`?roundId=${open.round.id}`, t.managerB)).toEqual({
      submissions: [],
      total: 0,
      nextCursor: null,
    });
  });
});

describe('moving submissions to a stage', () => {
  it('moves them in one go, with a transition and an audit event for each, and skips those already there', async () => {
    const { open, intake, review } = await aRound();
    const [a, b] = [await submitted(open), await submitted(open)];
    const audited = (await events(t.tenantA, 'grants.application.stage_changed')).length;

    expect(await answer<StageMoveResult>(move(review.id, [a, b]))).toEqual({ moved: 2 });
    expect([await stageOf(a), await stageOf(b)]).toEqual([review.id, review.id]);
    const transitions = await t.rows<{ from: string; to: string; by: string }>(
      `SELECT from_stage_id AS from, to_stage_id AS to, moved_by AS by FROM grants.stage_transition
        WHERE application_id = $1 AND from_stage_id IS NOT NULL`,
      [a],
    );
    expect(transitions).toEqual([{ from: intake.id, to: review.id, by: t.managerA.membershipId }]);
    const moved = (await events(t.tenantA, 'grants.application.stage_changed')).slice(audited);
    expect(moved.map((event) => event.entity_id).sort()).toEqual([a, b].sort());
    expect(moved[0]).toMatchObject({ actor_id: t.managerA.membershipId });
    expect(moved.find((event) => event.entity_id === a)?.changes).toEqual({
      'grants.application.stage_id': { before: intake.id, after: review.id },
    });

    expect(await answer<StageMoveResult>(move(review.id, [a, b]))).toEqual({ moved: 0 });
    expect(await answer<StageMoveResult>(move(intake.id, [a]))).toEqual({ moved: 1 });
    expect(await events(t.tenantA, 'grants.application.stage_changed')).toHaveLength(audited + 3);
  });

  it('moves none and names each submission that stops it', async () => {
    const { open, review } = await aRound();
    const elsewhere = await aRound();
    const [ok, gone, otherRound, theirs] = [
      await submitted(open),
      await submitted(open),
      await submitted(elsewhere.open),
      await submitted(await t.openRound(t.managerB, undefined), t.cat),
    ];
    await answer(t.send(t.ann, 'POST', t.path(gone, '/withdraw')));
    const draft = (await t.aDraft(t.ann, open.round.id)).id;
    const nobody = randomUUID();
    const audited = (await events(t.tenantA, 'grants.application.stage_changed')).length;

    const ids = [ok, gone, otherRound, draft, nobody, theirs];
    const refused = await move(review.id, ids);
    expect(refused.statusCode).toBe(409);
    const problem = refused.json<Problem>();
    expect(problem.errors?.map(({ field }) => field)).toEqual([
      'body.submissionIds.1',
      'body.submissionIds.2',
      'body.submissionIds.3',
      'body.submissionIds.4',
      'body.submissionIds.5',
    ]);
    expect(problem.errors?.map(({ message }) => message)).toEqual([
      expect.stringContaining('withdrawn'),
      expect.stringContaining('another round'),
      expect.stringContaining('not a submission'),
      expect.stringContaining('not a submission'),
      expect.stringContaining('not a submission'),
    ]);
    expect(refused.body).not.toContain(theirs);
    expect(await stageOf(ok)).not.toBe(review.id);
    expect(
      await t.rows(
        'SELECT 1 FROM grants.stage_transition WHERE application_id = $1 AND from_stage_id IS NOT NULL',
        [ok],
      ),
    ).toHaveLength(0);
    expect(await events(t.tenantA, 'grants.application.stage_changed')).toHaveLength(audited);
  });

  it('answers 404 for another tenant’s stage and changes nothing of theirs', async () => {
    const { open, review } = await aRound();
    const id = await submitted(open);
    const outside = await move(review.id, [id], t.managerB);
    expectLooksMissing(outside, await move(randomUUID(), [id], t.managerB));
    expect(await stageOf(id)).not.toBe(review.id);
  });

  it('takes 1 to 200 different submissions and nothing else', async () => {
    const { review } = await aRound();
    const ids = (count: number) => Array.from({ length: count }, () => randomUUID());
    const [one] = ids(1);
    for (const body of [
      { submissionIds: [] },
      { submissionIds: ids(201) },
      { submissionIds: [one, one] },
      { submissionIds: [one], stageId: review.id },
      {},
    ]) {
      expect((await t.send(t.managerA, 'POST', movePath(review.id), body)).statusCode).toBe(400);
    }
    expect((await move(review.id, ids(200))).statusCode).toBe(409);
  });
});

describe('who may use the routes', () => {
  it('refuse a reviewer and an applicant, a signed-out caller, and answer 404 with grants off', async () => {
    const { open, review } = await aRound();
    const id = await submitted(open);
    const every: [Method, string, unknown][] = [
      ['GET', listPath(), undefined],
      ['GET', detailPath(id), undefined],
      ['POST', movePath(review.id), { submissionIds: [id] }],
    ];
    for (const [method, url, payload] of every) {
      expect((await t.send(t.reviewerA, method, url, payload)).statusCode, url).toBe(403);
      expect((await t.send(t.applicantA, method, url, payload, 'console')).statusCode, url).toBe(
        403,
      );
      expect((await t.send(t.ann, method, url, payload, 'portal')).statusCode, url).toBe(403);
      expect((await t.send(undefined, method, url, payload)).statusCode, url).toBe(401);
    }
    expect(await stageOf(id)).not.toBe(review.id);

    const switchTo = (enabled: boolean) =>
      asMigratorIn(t.tenantA.id, (client) =>
        client
          .query(
            `INSERT INTO app.tenant_module (tenant_id, module, enabled, updated_by)
             VALUES ($1, 'grants', $2, $3)
             ON CONFLICT (tenant_id, module) DO UPDATE SET enabled = EXCLUDED.enabled`,
            [t.tenantA.id, enabled, t.managerA.membershipId],
          )
          .then(() => undefined),
      );
    await switchTo(false);
    try {
      for (const [method, url, payload] of every) {
        expect((await t.send(t.managerA, method, url, payload)).statusCode, url).toBe(404);
      }
    } finally {
      await switchTo(true);
    }
  });
});
