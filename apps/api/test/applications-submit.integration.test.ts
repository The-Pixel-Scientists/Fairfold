// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Saving, eligibility, submitting and withdrawing through the whole API
// against the test database, as app_api: what the server refuses whatever the
// client believes, and what each step leaves in the tables and the audit log.

import type { AnswersSaved, Application, Eligibility } from '@pixel-scientists/grants/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  accounts,
  charity,
  complete,
  fields,
  startApplicationsApi,
  type ApplicationsApi,
} from './applications-api.ts';
import { answer, type Problem } from './programme-api.ts';
import { events } from './settings-api.ts';

// Each request runs a few statements in a transaction, which is slow on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

let t: ApplicationsApi;

beforeAll(async () => {
  t = await startApplicationsApi('41031');
}, 60_000);

afterAll(async () => {
  await t.close();
});

const read = (id: string) => answer<Application>(t.send(t.ann, 'GET', t.path(id)));

const stored = async (id: string) =>
  (
    await t.rows<{
      status: string;
      answers: object;
      version: number;
      late: boolean;
      stage: string | null;
    }>(
      `SELECT status, answers, answers_version AS version, submitted_late AS late, stage_id AS stage
         FROM grants.application WHERE id = $1`,
      [id],
    )
  )[0];

async function start(...formFields: object[]) {
  const open = await t.openRound(t.managerA, formFields.length === 0 ? fields : formFields);
  return { open, draft: await t.aDraft(t.ann, open.round.id) };
}

describe('saving answers', () => {
  it('replaces the answers, counts the save, keeps them as the applicant sees them, and audits nothing', async () => {
    const { draft } = await start();
    const before = (await events(t.tenantA, 'grants.application.created')).length;
    const first = await answer<AnswersSaved>(t.save(t.ann, draft, { f_title: 'One' }));
    expect(first.answersVersion).toBe(2);
    const next = await answer<AnswersSaved>(
      t.save(t.ann, draft, { f_title: 'Two', f_turnover: 120_000 }, 2),
    );
    expect(next.answersVersion).toBe(3);

    const now = await read(draft.id);
    expect(now.answers).toEqual({ f_title: 'Two', f_turnover: 120_000 });
    expect((await stored(draft.id))?.version).toBe(3);
    expect(await events(t.tenantA, 'grants.application.created')).toHaveLength(before);
  });

  it('refuses answers based on an older version, and a second tab changes nothing', async () => {
    const { draft } = await start();
    await answer(t.save(t.ann, draft, { f_title: 'First tab' }));
    const stale = await t.save(t.ann, draft, { f_title: 'Second tab' }, 1);
    expect(stale.statusCode).toBe(409);
    expect((await stored(draft.id))?.answers).toEqual({ f_title: 'First tab' });
  });

  it('refuses a wrong type, an unknown field, a hidden field and a file question, naming each', async () => {
    const { draft } = await start(charity, ...fields.slice(1), accounts);
    const refused = async (answers: object) => {
      const response = await t.save(t.ann, draft, answers);
      expect(response.statusCode).toBe(400);
      return response.json<Problem>().errors?.map(({ field }) => field);
    };
    expect(await refused({ f_title: 12 })).toEqual(['f_title']);
    expect(await refused({ f_nothere: 'x' })).toEqual(['f_nothere']);
    expect(await refused({ f_haveweb: false, f_web: 'https://example.org' })).toEqual(['f_web']);
    expect(await refused({ f_accounts: ['0b5d1c4e-6f3a-4d2b-9c8e-1a2b3c4d5e6f'] })).toEqual([
      'f_accounts',
    ]);
    expect((await stored(draft.id))?.answers).toEqual({});
  });

  it('refuses a body with extra keys, and a submitted application’s answers', async () => {
    const { draft } = await start();
    const extra = await t.send(t.ann, 'PUT', t.path(draft.id, '/answers'), {
      basedOn: 1,
      answers: {},
      status: 'submitted',
    });
    expect(extra.statusCode).toBe(400);

    const saved = await t.saved(t.ann, draft, complete);
    await answer(t.submit(t.ann, saved));
    expect((await t.save(t.ann, saved, { f_title: 'Changed' })).statusCode).toBe(409);
    expect((await stored(draft.id))?.answers).toEqual(complete);
  });
});

describe('the eligibility check', () => {
  it('records an eligible or stopped result with the stopping field, and audits each', async () => {
    const { draft } = await start();
    const first = await t.send(t.ann, 'POST', t.path(draft.id, '/eligibility-check'));
    expect(first.json<Eligibility>()).toEqual({ status: 'incomplete' });
    expect(
      await t.rows('SELECT 1 FROM grants.eligibility_result WHERE application_id = $1', [draft.id]),
    ).toHaveLength(0);

    const saved = await t.saved(t.ann, draft, { f_charity: false });
    const stopped = await answer<Eligibility>(
      t.send(t.ann, 'POST', t.path(draft.id, '/eligibility-check')),
    );
    expect(stopped).toEqual({
      status: 'stopped',
      fieldId: 'f_charity',
      explanation: 'Only registered charities can apply.',
    });
    await t.saved(t.ann, saved, { f_charity: true });
    expect(
      await answer<Eligibility>(t.send(t.ann, 'POST', t.path(draft.id, '/eligibility-check'))),
    ).toEqual({ status: 'eligible' });

    const results = await t.rows<{ outcome: string; field: string | null; by: string }>(
      `SELECT outcome, stopping_field_id AS field, checked_by AS by
         FROM grants.eligibility_result WHERE application_id = $1 ORDER BY checked_at, id`,
      [draft.id],
    );
    expect(results).toEqual([
      { outcome: 'stopped', field: 'f_charity', by: t.ann.membershipId },
      { outcome: 'eligible', field: null, by: t.ann.membershipId },
    ]);
    const audited = (await events(t.tenantA, 'grants.application.eligibility_checked')).filter(
      ({ entity_id }) => entity_id === draft.id,
    );
    expect(audited).toHaveLength(2);
  });
});

describe('submitting', () => {
  it('submits the saved answers into the first stage, with a transition and an audit event', async () => {
    const { draft } = await start();
    const saved = await t.saved(t.ann, draft, complete);
    const submitted = await answer<Application>(t.submit(t.ann, saved));
    expect(submitted).toMatchObject({ status: 'submitted', outcome: null });
    expect(submitted.submittedAt).not.toBeNull();

    const row = await stored(draft.id);
    expect(row).toMatchObject({ status: 'submitted', late: false });
    const [transition] = await t.rows<{
      from_stage_id: string | null;
      to_stage_id: string;
      name: string;
    }>(
      `SELECT x.from_stage_id, x.to_stage_id, s.name FROM grants.stage_transition x
         JOIN grants.stage s ON s.id = x.to_stage_id WHERE x.application_id = $1`,
      [draft.id],
    );
    expect(transition).toEqual({ from_stage_id: null, to_stage_id: row?.stage, name: 'Intake' });
    const [event] = (await events(t.tenantA, 'grants.application.submitted')).filter(
      ({ entity_id }) => entity_id === draft.id,
    );
    expect(event?.actor_id).toBe(t.ann.membershipId);
    expect(event?.changes).toMatchObject({ 'grants.application.status': { after: 'submitted' } });
  });

  it('refuses answers based on an older version, a second submission, and missing answers', async () => {
    const { draft } = await start();
    const incomplete = await t.saved(t.ann, draft, { f_charity: true });
    const missing = await t.submit(t.ann, incomplete);
    expect(missing.statusCode).toBe(400);
    expect(missing.json<Problem>().errors?.map(({ field }) => field)).toEqual(['f_title']);

    const saved = await t.saved(t.ann, incomplete, complete);
    const stale = await t.send(t.ann, 'POST', t.path(draft.id, '/submit'), { basedOn: 1 });
    expect(stale.statusCode).toBe(409);
    await answer(t.submit(t.ann, saved));
    expect((await t.submit(t.ann, saved)).statusCode).toBe(409);
    expect(
      await t.rows('SELECT 1 FROM grants.stage_transition WHERE application_id = $1', [draft.id]),
    ).toHaveLength(1);
  });

  it('refuses an applicant who is not eligible, with the funder’s explanation', async () => {
    const { draft } = await start();
    const saved = await t.saved(t.ann, draft, { ...complete, f_charity: false });
    const refused = await t.submit(t.ann, saved);
    expect(refused.statusCode).toBe(400);
    expect(refused.json<Problem>().detail).toBe('Only registered charities can apply.');
    expect((await stored(draft.id))?.status).toBe('draft');
  });

  it('checks the stored answers again, not the client’s view of what is shown', async () => {
    const { draft } = await start();
    const saved = await t.saved(t.ann, draft, complete);
    // An answer to a question that is not shown, which no save could have stored.
    await t.rows(
      `UPDATE grants.application SET answers = answers || '{"f_web":"https://example.org"}' WHERE id = $1 RETURNING id`,
      [draft.id],
    );
    const refused = await t.submit(t.ann, saved);
    expect(refused.statusCode).toBe(400);
    expect(refused.json<Problem>().errors?.map(({ field }) => field)).toEqual(['f_web']);
  });

  it('refuses a late submission under the refuse policy, and marks it late under accept_and_flag', async () => {
    const refuse = await start();
    const accept = await t.openRound(t.managerA, fields, {
      round: { latePolicy: 'accept_and_flag' },
    });
    const flagged = await t.aDraft(t.ben, accept.round.id);
    const ready = [
      await t.saved(t.ann, refuse.draft, complete),
      await t.saved(t.ben, flagged, complete),
    ] as const;
    for (const { round } of [refuse.open, accept]) {
      await t.changeRound(round.id, "closes_at = now() - interval '1 hour'");
    }

    const refused = await t.submit(t.ann, ready[0]);
    expect(refused.statusCode).toBe(400);
    expect(refused.json<Problem>().detail).toMatch(
      /^This round closed on \d+ \w+ \d{4} at \d\d:\d\d\.$/,
    );
    expect((await stored(refuse.draft.id))?.status).toBe('draft');

    await answer(t.submit(t.ben, ready[1]));
    expect(await stored(flagged.id)).toMatchObject({ status: 'submitted', late: true });
  });

  it('refuses a submission whatever the late policy once the programme is closed or the round has not opened', async () => {
    for (const latePolicy of ['refuse', 'accept_and_flag'] as const) {
      const closed = await t.openRound(t.managerA, fields, { round: { latePolicy } });
      const unopened = await t.openRound(t.managerA, fields, { round: { latePolicy } });
      const drafts = [
        await t.aDraft(t.ann, closed.round.id),
        await t.aDraft(t.ben, unopened.round.id),
      ] as const;
      const ready = [
        await t.saved(t.ann, drafts[0], complete),
        await t.saved(t.ben, drafts[1], complete),
      ] as const;
      await t.changeProgramme(closed.programmeId, "status = 'closed'");
      await t.changeRound(unopened.round.id, "opens_at = now() + interval '1 hour'");

      for (const [member, application] of [
        [t.ann, ready[0]],
        [t.ben, ready[1]],
      ] as const) {
        expect((await t.submit(member, application)).statusCode).toBe(404);
        expect(await stored(application.id)).toMatchObject({
          status: 'draft',
          stage: null,
          late: false,
        });
      }
    }
  });

  it('keeps aggregate-only answers for the applicant', async () => {
    const { draft } = await start();
    const saved = await t.saved(t.ann, draft, { ...complete, f_turnover: 50_000 });
    const submitted = await answer<Application>(t.submit(t.ann, saved));
    expect(submitted.answers).toMatchObject({ f_turnover: 50_000 });
  });
});

describe('withdrawing', () => {
  it('withdraws a submitted application for good, audits it, and frees the organisation', async () => {
    const { open, draft } = await start();
    expect((await t.send(t.ann, 'POST', t.path(draft.id, '/withdraw'))).statusCode).toBe(409);

    const saved = await t.saved(t.ann, draft, complete);
    await answer(t.submit(t.ann, saved));
    const withdrawn = await answer<Application>(
      t.send(t.ann, 'POST', t.path(draft.id, '/withdraw')),
    );
    expect(withdrawn).toMatchObject({ status: 'withdrawn' });
    expect(withdrawn.withdrawnAt).not.toBeNull();
    expect((await t.send(t.ann, 'POST', t.path(draft.id, '/withdraw'))).statusCode).toBe(409);
    expect((await t.submit(t.ann, saved)).statusCode).toBe(409);
    expect(
      (await events(t.tenantA, 'grants.application.withdrawn')).map((e) => e.entity_id),
    ).toContain(draft.id);

    const again = await t.send(t.ann, 'POST', t.startPath(open.round.id), {
      organisationId: draft.organisation.id,
    });
    expect(again.statusCode).toBe(201);
  });
});
