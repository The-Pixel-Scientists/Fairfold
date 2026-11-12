// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The alternative route through the whole API against the test database, as
// app_api, for two tenants: staff acting for an applicant only with a live
// alternative route and a recent sign-in, the applicant staying the applicant,
// the portal's own rules applying, and the whole submit rolling back together.

import { randomUUID } from 'node:crypto';

import type {
  Adjustment,
  AnswersSaved,
  Application,
  ApplicationList,
  AssistedApplication,
  AssistedList,
  Submission,
  SubmissionPage,
} from '@pixel-scientists/grants/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { asMigratorIn } from '../../../packages/db/test/tenants.ts';
import { complete, startApplicationsApi, type ApplicationsApi } from './applications-api.ts';
import { answer, type Problem } from './programme-api.ts';
import { events, type Member } from './settings-api.ts';
import { expectLooksMissing } from './support.ts';

// Each request runs a few statements in a transaction, which is slow on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

let t: ApplicationsApi;

beforeAll(async () => {
  t = await startApplicationsApi('41081');
}, 60_000);

afterAll(async () => {
  await t.close();
});

const roundPath = (roundId: string) => `/console/rounds/${roundId}/assisted-applications`;
const draftPath = (id: string, tail = '') => `/console/assisted-applications/${id}${tail}`;

/** A request as `member` who signed in again a moment ago, as the start and submit routes need. */
const asStaff = (
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  payload?: unknown,
  member: Member = t.managerA,
  signedIn: Date | null = new Date(),
) => t.send(member, method, url, payload, 'console', signedIn);

const personOf = async (member: Member) =>
  (
    await t.rows<{ id: string }>('SELECT id FROM party.person WHERE user_id = $1', [member.userId])
  )[0]?.id ?? '';

/** An organisation of `ann` in a new round, with the alternative route unless left out. */
async function setUp(options: { route?: boolean; round?: object } = {}) {
  const open = await t.openRound(t.managerA, undefined, { round: options.round });
  const organisationId = await t.organisationOf(t.ann);
  const route =
    options.route === false
      ? undefined
      : await answer<Adjustment>(
          t.send(t.managerA, 'POST', `/console/rounds/${open.round.id}/adjustments`, {
            kind: 'alternative_route',
            organisationId,
            reasonCode: 'access_needs',
          }),
          201,
        );
  const body = { organisationId, contactPersonId: await personOf(t.ann) };
  return { open, organisationId, route, body };
}

const start = (roundId: string, body: object, member: Member = t.managerA) =>
  asStaff('POST', roundPath(roundId), body, member);

async function aDraft(options: Parameters<typeof setUp>[0] = {}) {
  const made = await setUp(options);
  const draft = await answer<AssistedApplication>(start(made.open.round.id, made.body), 201);
  return { ...made, draft };
}

const save = (draft: AssistedApplication, answers: object, member: Member = t.managerA) =>
  asStaff(
    'PUT',
    draftPath(draft.id, '/answers'),
    { basedOn: draft.answersVersion, answers },
    member,
  );

const submit = (draft: AssistedApplication, answersVersion: number, signedIn?: Date | null) =>
  asStaff(
    'POST',
    draftPath(draft.id, '/submit'),
    { basedOn: answersVersion },
    t.managerA,
    signedIn,
  );

const stored = async (id: string) =>
  (
    await t.rows<{
      status: string;
      route: string;
      submitted_by: string | null;
      applicant: string;
      created_by: string;
      stage_id: string | null;
    }>(
      `SELECT status, submission_route AS route, submitted_by, applicant_person_id AS applicant,
              created_by, stage_id
         FROM grants.application WHERE id = $1`,
      [id],
    )
  )[0];

/** A ready draft: answers saved, and the version the submit is based on. */
async function ready(options: Parameters<typeof setUp>[0] = {}) {
  const made = await aDraft(options);
  const saved = await answer<AnswersSaved>(save(made.draft, complete));
  return { ...made, version: saved.answersVersion };
}

describe('starting an assisted application', () => {
  it('starts one for an organisation with the alternative route, for its contact, as the session’s member', async () => {
    const { draft, organisationId, body } = await aDraft();

    expect(draft).toMatchObject({
      organisation: { id: organisationId },
      contact: { personId: body.contactPersonId },
      answersVersion: 1,
    });
    expect(await stored(draft.id)).toMatchObject({
      status: 'draft',
      route: 'assisted',
      submitted_by: null,
      applicant: body.contactPersonId,
      created_by: t.managerA.membershipId,
    });
    const [event] = (await events(t.tenantA, 'grants.application.created')).filter(
      ({ entity_id }) => entity_id === draft.id,
    );
    expect(event?.actor_id).toBe(t.managerA.membershipId);
  });

  it('is refused without a live alternative route, after it is removed, and for another organisation’s', async () => {
    const none = await setUp({ route: false });
    expect((await start(none.open.round.id, none.body)).statusCode).toBe(409);

    const removed = await setUp();
    await answer(
      t.send(t.managerA, 'POST', `/console/adjustments/${removed.route?.id}/revoke`, {
        reasonCode: 'other',
      }),
    );
    expect((await start(removed.open.round.id, removed.body)).statusCode).toBe(409);

    const mine = await setUp({ route: false });
    const theirs = await t.organisationOf(t.ben, 'Southfield Gardeners');
    await answer(
      t.send(t.managerA, 'POST', `/console/rounds/${mine.open.round.id}/adjustments`, {
        kind: 'alternative_route',
        organisationId: theirs,
        reasonCode: 'other',
      }),
      201,
    );
    expect((await start(mine.open.round.id, mine.body)).statusCode).toBe(409);
    for (const round of [none, removed, mine]) {
      expect(
        await t.rows('SELECT 1 FROM grants.application WHERE round_id = $1', [round.open.round.id]),
      ).toHaveLength(0);
    }
  });

  it('needs a sign-in within five minutes, and names no member, user or tenant in the body', async () => {
    const { open, body } = await setUp();

    expect(
      (await asStaff('POST', roundPath(open.round.id), body, t.managerA, null)).statusCode,
    ).toBe(403);
    const tenMinutesAgo = new Date(Date.now() - 10 * 60_000);
    expect(
      (await asStaff('POST', roundPath(open.round.id), body, t.managerA, tenMinutesAgo)).statusCode,
    ).toBe(403);
    for (const extra of [{ membershipId: t.ada.membershipId }, { userId: t.ada.userId }]) {
      expect((await start(open.round.id, { ...body, ...extra })).statusCode).toBe(400);
    }
    expect(
      await t.rows('SELECT 1 FROM grants.application WHERE round_id = $1', [open.round.id]),
    ).toHaveLength(0);
  });

  it('checks the contact person through party, and refuses a second application for the organisation', async () => {
    const { open, body } = await setUp();
    await t.organisationOf(t.ben, 'Southfield Gardeners');
    const notContact = await start(open.round.id, {
      ...body,
      contactPersonId: await personOf(t.ben),
    });
    expect(notContact.statusCode).toBe(400);
    expect(notContact.json<Problem>().errors?.map(({ field }) => field)).toEqual([
      'body.contactPersonId',
    ]);

    await answer<AssistedApplication>(start(open.round.id, body), 201);
    expect((await start(open.round.id, body)).statusCode).toBe(409);
  });

  it('is replayed, not repeated, by the same idempotency key', async () => {
    const { open, body } = await setUp();
    const key = randomUUID();
    const send = () =>
      t.send(t.managerA, 'POST', roundPath(open.round.id), body, 'console', new Date(), key);
    const first = await answer<AssistedApplication>(send(), 201);
    const again = await answer<AssistedApplication>(send(), 201);

    expect(again.id).toBe(first.id);
    expect(
      await t.rows('SELECT 1 FROM grants.application WHERE round_id = $1', [open.round.id]),
    ).toHaveLength(1);
  });
});

describe('an assisted draft', () => {
  it('stays out of the submissions list and the applicant’s portal until it is submitted', async () => {
    const { open, draft, version } = await ready();

    const listed = await answer<SubmissionPage>(
      t.send(t.managerA, 'GET', `/console/submissions?roundId=${open.round.id}`),
    );
    expect(listed.submissions).toHaveLength(0);
    expect((await t.send(t.managerA, 'GET', `/console/submissions/${draft.id}`)).statusCode).toBe(
      404,
    );
    const assisted = await answer<AssistedList>(
      t.send(t.managerA, 'GET', roundPath(open.round.id)),
    );
    expect(assisted.applications.map(({ id }) => id)).toEqual([draft.id]);

    const portal = await answer<ApplicationList>(t.send(t.ann, 'GET', '/portal/applications'));
    expect(portal.applications.map(({ id }) => id)).not.toContain(draft.id);
    for (const [method, tail, payload] of [
      ['GET', '', undefined],
      ['PUT', '/answers', { basedOn: version, answers: { f_title: 'Mine' } }],
      ['POST', '/eligibility-check', undefined],
      ['POST', '/submit', { basedOn: version }],
    ] as const) {
      expect((await t.send(t.ann, method, t.path(draft.id, tail), payload)).statusCode).toBe(404);
    }
    expect(
      (
        await t.send(t.ann, 'POST', t.startPath(open.round.id), {
          organisationId: draft.organisation.id,
        })
      ).statusCode,
    ).toBe(409);
  });

  it('is saved and checked as the portal’s are, and a save audits field ids, never values', async () => {
    const { draft } = await aDraft();
    const saved = await answer<AnswersSaved>(
      save(draft, { f_title: 'Village hall roof', f_charity: true }),
    );
    expect(saved.answersVersion).toBe(2);
    expect((await save(draft, { f_title: 'Stale' })).statusCode).toBe(409);
    expect((await save({ ...draft, answersVersion: 2 }, { f_nothere: 'x' })).statusCode).toBe(400);

    const eligible = await answer(asStaff('POST', draftPath(draft.id, '/eligibility-check')));
    expect(eligible).toEqual({ status: 'eligible' });
    const read = await answer<AssistedApplication>(asStaff('GET', draftPath(draft.id)));
    expect(read.answers).toMatchObject({ f_title: 'Village hall roof' });

    const [event] = (await events(t.tenantA, 'grants.application.answers_saved_on_behalf')).filter(
      ({ entity_id }) => entity_id === draft.id,
    );
    expect(event?.actor_id).toBe(t.managerA.membershipId);
    expect(Object.keys(event?.changes ?? {})).toEqual(
      expect.arrayContaining(['f_title', 'f_charity']),
    );
    expect(JSON.stringify(event?.changes)).not.toContain('Village hall roof');
    expect(
      (await events(t.tenantA, 'grants.application.viewed')).map((e) => e.entity_id),
    ).toContain(draft.id);
  });

  it('cannot be saved, checked or submitted once the alternative route is removed', async () => {
    const { draft, route, version } = await ready();
    await answer(
      t.send(t.managerA, 'POST', `/console/adjustments/${route?.id}/revoke`, {
        reasonCode: 'other',
      }),
    );

    expect((await save(draft, { f_title: 'Changed' })).statusCode).toBe(409);
    expect((await asStaff('POST', draftPath(draft.id, '/eligibility-check'))).statusCode).toBe(409);
    expect((await submit(draft, version)).statusCode).toBe(409);
    expect((await stored(draft.id))?.status).toBe('draft');
  });
});

describe('submitting for the applicant', () => {
  it('submits as the session’s member, leaves the applicant unchanged, and audits both events', async () => {
    const { draft, version, body } = await ready();
    const submitted = await answer<Submission>(submit(draft, version));

    expect(submitted).toMatchObject({
      status: 'submitted',
      submissionRoute: 'assisted',
      submittedBy: { membershipId: t.managerA.membershipId },
      contact: { personId: body.contactPersonId },
    });
    expect(await stored(draft.id)).toMatchObject({
      status: 'submitted',
      route: 'assisted',
      submitted_by: t.managerA.membershipId,
      applicant: body.contactPersonId,
      created_by: t.managerA.membershipId,
    });
    expect((await stored(draft.id))?.stage_id).not.toBeNull();
    for (const action of [
      'grants.application.submitted',
      'grants.application.submitted_on_behalf',
    ]) {
      const [event] = (await events(t.tenantA, action)).filter(
        ({ entity_id }) => entity_id === draft.id,
      );
      expect(event?.actor_id, action).toBe(t.managerA.membershipId);
      expect(JSON.stringify(event?.changes), action).not.toContain('Village hall roof');
    }
    expect((await submit(draft, version)).statusCode).toBe(409);
  });

  it('tells the applicant staff submitted it, and who did not', async () => {
    const { draft, version } = await ready();
    await answer(submit(draft, version));

    const response = await t.send(t.ann, 'GET', t.path(draft.id));
    const view = response.json<Application>();
    expect(view).toMatchObject({ status: 'submitted', submissionRoute: 'assisted' });
    expect(response.body).not.toContain(t.managerA.membershipId);
  });

  it('is refused without a recent sign-in, and a portal submission sets the portal route and no submitter', async () => {
    const { draft, version } = await ready();
    expect((await submit(draft, version, null)).statusCode).toBe(403);
    expect((await stored(draft.id))?.status).toBe('draft');

    const portal = await t.aDraft(t.ben, (await t.openRound()).round.id);
    await answer(t.submit(t.ben, await t.saved(t.ben, portal, complete)));
    expect(await stored(portal.id)).toMatchObject({ route: 'portal', submitted_by: null });
  });

  it('refuses the same invalid and ineligible answers the portal refuses, in the same words', async () => {
    const assisted = await aDraft();
    let portalDraft = await t.aDraft(t.ben, assisted.open.round.id);
    let version = assisted.draft.answersVersion;

    for (const answers of [{ f_charity: true }, { ...complete, f_charity: false }]) {
      ({ answersVersion: version } = await answer<AnswersSaved>(
        save({ ...assisted.draft, answersVersion: version }, answers),
      ));
      const staff = await submit(assisted.draft, version);
      portalDraft = await t.saved(t.ben, portalDraft, answers);
      const portal = await t.submit(t.ben, portalDraft);

      expect(staff.statusCode).toBe(400);
      expect(portal.statusCode).toBe(400);
      const [a, b] = [staff.json<Problem>(), portal.json<Problem>()];
      expect({ detail: a.detail, errors: a.errors }).toEqual({
        detail: b.detail,
        errors: b.errors,
      });
    }
  });

  it('uses the extended closing time: refuses after the round closes under the refuse policy', async () => {
    const { draft, open, version } = await ready();
    await t.changeRound(open.round.id, "closes_at = now() - interval '1 hour'");
    const refused = await submit(draft, version);
    expect(refused.statusCode).toBe(400);
    expect((await stored(draft.id))?.status).toBe('draft');
  });

  it('rolls everything back when anything after the audit write fails', async () => {
    const { draft, version } = await ready();
    await asMigratorIn(t.tenantA.id, async (client) => {
      await client.query(`CREATE FUNCTION public.fail_on_behalf() RETURNS trigger LANGUAGE plpgsql
        AS $$ BEGIN RAISE EXCEPTION 'forced'; END $$`);
      await client.query(`CREATE TRIGGER fail_on_behalf AFTER INSERT ON app.audit_event
        FOR EACH ROW WHEN (NEW.action = 'grants.application.submitted_on_behalf')
        EXECUTE FUNCTION public.fail_on_behalf()`);
    });
    let response;
    try {
      response = await submit(draft, version);
    } finally {
      await asMigratorIn(t.tenantA.id, async (client) => {
        await client.query('DROP TRIGGER fail_on_behalf ON app.audit_event');
        await client.query('DROP FUNCTION public.fail_on_behalf()');
      });
    }

    expect(response.statusCode).toBe(500);
    expect(await stored(draft.id)).toMatchObject({
      status: 'draft',
      route: 'assisted',
      stage_id: null,
    });
    expect(
      await t.rows('SELECT 1 FROM grants.stage_transition WHERE application_id = $1', [draft.id]),
    ).toHaveLength(0);
    expect(
      (await events(t.tenantA, 'grants.application.submitted')).map((e) => e.entity_id),
    ).not.toContain(draft.id);
  });
});

describe('who may use the alternative route', () => {
  it('is for members who can assist: a reviewer and an applicant are refused', async () => {
    const { open, body, draft } = await aDraft();
    const requests = [
      ['POST', roundPath(open.round.id), body],
      ['GET', roundPath(open.round.id), undefined],
      ['GET', draftPath(draft.id), undefined],
      ['PUT', draftPath(draft.id, '/answers'), { basedOn: 1, answers: {} }],
      ['POST', draftPath(draft.id, '/eligibility-check'), undefined],
      ['POST', draftPath(draft.id, '/submit'), { basedOn: 1 }],
    ] as const;
    for (const [method, url, payload] of requests) {
      expect((await asStaff(method, url, payload, t.reviewerA)).statusCode, url).toBe(403);
      expect((await asStaff(method, url, payload, t.ann)).statusCode, url).toBe(403);
    }
  });

  it('answers another tenant’s round, organisation and draft as missing, and writes nothing', async () => {
    const { open, body, draft, version } = await ready();
    const unknown = randomUUID();

    expectLooksMissing(
      await start(open.round.id, body, t.managerB),
      await start(unknown, body, t.managerB),
    );
    expectLooksMissing(
      await asStaff('GET', roundPath(open.round.id), undefined, t.managerB),
      await asStaff('GET', roundPath(unknown), undefined, t.managerB),
    );
    expectLooksMissing(
      await asStaff('GET', draftPath(draft.id), undefined, t.managerB),
      await asStaff('GET', draftPath(unknown), undefined, t.managerB),
    );
    const missing = await save({ ...draft, id: unknown }, {}, t.managerB);
    expectLooksMissing(await save({ ...draft, answersVersion: version }, {}, t.managerB), missing);
    expectLooksMissing(
      await asStaff('POST', draftPath(draft.id, '/submit'), { basedOn: version }, t.managerB),
      await asStaff('POST', draftPath(unknown, '/submit'), { basedOn: version }, t.managerB),
    );
    expect((await stored(draft.id))?.status).toBe('draft');
    expect(
      await t.rows('SELECT 1 FROM grants.application WHERE round_id = $1', [open.round.id]),
    ).toHaveLength(1);
  });
});
