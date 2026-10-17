// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Releasing decisions through the whole API against the test database, as
// app_api: private until released (architecture rule 8), a recent sign-in
// for the release (ADR 0010), one email each with nothing but the allowlist
// in it (ADR 0004), and a decision fixed once released.

import { randomUUID } from 'node:crypto';

import type {
  Application,
  ApplicationList,
  ReleaseResult,
} from '@pixel-scientists/grants/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  accepted,
  declined,
  PORTAL,
  pounds,
  startDecisionsApi,
  waitlisted,
  type DecisionsApi,
} from './decisions-api.ts';
import { answer, type Problem } from './programme-api.ts';
import { expectLooksMissing } from './support.ts';

// Each request runs a few statements in a transaction, which is slow on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

let t: DecisionsApi;

beforeAll(async () => {
  t = await startDecisionsApi('41051');
}, 60_000);

afterAll(async () => {
  await t.close();
});

/** A round with three submissions, the applicant named Ada with an address of her own. */
async function aRound() {
  const round = await t.reviewRound();
  const [a, b, c] = [
    await t.submission(round),
    await t.submission(round),
    await t.submission(round),
  ];
  const email = `ada-${randomUUID()}@example.org`;
  await t.personOf(t.ann, 'Ada', email);
  return { round, roundId: round.open.round.id, a, b, c, email };
}

const application = (id: string) => answer<Application>(t.send(t.ann, 'GET', t.path(id)));

describe('before release', () => {
  it('shows an applicant nothing of a recorded decision on any portal route', async () => {
    const { roundId, a } = await aRound();
    await t.recorded(a, accepted(12_345));

    const seen: string[] = [];
    const walk = async (method: 'GET' | 'PUT' | 'POST', url: string, body?: unknown) => {
      const response = await t.send(t.ann, method, url, body);
      seen.push(`${method} ${url} ${response.statusCode} ${response.body}`);
      return response;
    };
    await walk('GET', '/portal/rounds');
    await walk('GET', `/portal/rounds/${roundId}`);
    await walk('GET', '/portal/applications');
    const viewed = await walk('GET', t.path(a));
    await walk('PUT', t.path(a, '/answers'), { basedOn: 1, answers: {} });
    await walk('POST', t.path(a, '/eligibility-check'));
    await walk('POST', t.path(a, '/submit'), { basedOn: 1 });
    await walk('POST', t.startPath(roundId), { organisationId: randomUUID() });

    expect(viewed.json<Application>()).toMatchObject({ outcome: null });
    expect(['submitted', 'under_review']).toContain(viewed.json<Application>().status);
    const listed = await answer<ApplicationList>(t.send(t.ann, 'GET', '/portal/applications'));
    expect(listed.applications.find((item) => item.id === a)).toMatchObject({ outcome: null });
    for (const line of seen) {
      expect(line, line).not.toMatch(/accepted|awarded|waitlist|declined|not_funded|12345|12,345/i);
    }
    // Withdrawing last: the answer is the application as an applicant sees it.
    const withdrawn = await walk('POST', t.path(a, '/withdraw'));
    expect(withdrawn.statusCode).toBe(200);
    expect(withdrawn.body).not.toMatch(/accepted|awarded|12345/i);
  });

  it('refuses a release without a recent sign-in, and releases and sends nothing', async () => {
    const { roundId, a } = await aRound();
    await t.recorded(a, declined);

    const release = await t.send(t.managerA, 'POST', t.roundPath(roundId, '/release'), {
      release: 'all',
    });
    const resend = await t.send(
      t.managerA,
      'POST',
      `/console/rounds/${roundId}/decision-emails/send`,
    );

    expect(release.statusCode).toBe(403);
    expect(resend.statusCode).toBe(403);
    const [row] = await t.decisions<{ released_at: Date | null }>('d.application_id = $1', [a]);
    expect(row?.released_at).toBeNull();
    expect(t.sent).toEqual([]);
  });

  it('needs the release to say which decisions: a missing choice releases nothing', async () => {
    const { roundId, a } = await aRound();
    await t.recorded(a, declined);
    for (const body of [{}, { release: 'chosen' }, { release: 'chosen', submissionIds: [] }]) {
      expect((await t.release(roundId, body)).statusCode).toBe(400);
    }
    expect(
      (await t.decisions<{ released_at: Date | null }>('d.application_id = $1', [a]))[0]
        ?.released_at,
    ).toBeNull();
  });
});

describe('releasing', () => {
  it('releases every recorded decision, emails each applicant once, and shows the outcome', async () => {
    const { roundId, a, b, c, email } = await aRound();
    await t.recorded(a, accepted(15_000));
    await t.recorded(b, declined);
    t.sent.length = 0;

    const result = await answer<ReleaseResult>(t.release(roundId));

    expect(result).toEqual({ released: 2, sent: 2, failed: 0, pending: 0 });
    const text = (to: string) => t.sent.filter((message) => message.to === to);
    expect(t.sent.map((message) => message.to)).toEqual([email, email]);
    expect(
      text(email)
        .map((message) => message.subject)
        .sort(),
    ).toEqual([
      'Community Spaces Fund: the decision on your application',
      'Community Spaces Fund: we are offering you a grant',
    ]);
    const award = t.sent.find((message) => message.subject.includes('offering'));
    expect(award?.text).toBe(
      [
        'Dear Ada,',
        '',
        'Thank you for applying to Community Spaces Fund (Autumn 2026) for Northfield Allotment Society.',
        '',
        'We are pleased to offer you a grant of £15,000.',
        '',
        'Sign in to see the offer and what happens next:',
        PORTAL,
      ].join('\n'),
    );
    const decline = t.sent.find((message) => message.subject.includes('decision on'));
    expect(decline?.text).toBe(
      [
        'Dear Ada,',
        '',
        'Thank you for applying to Community Spaces Fund (Autumn 2026) for Northfield Allotment Society.',
        '',
        'We have decided not to offer you a grant this time.',
        '',
        'Sign in to see your application:',
        PORTAL,
      ].join('\n'),
    );

    const rows = await t.decisions<{
      id: string;
      application_id: string;
      released_by: string | null;
      released_at: Date | null;
    }>('d.application_id = ANY($1)', [[a, b, c]]);
    expect(rows.map((row) => row.application_id).sort()).toEqual([a, b].sort());
    for (const row of rows) {
      expect(row.released_by).toBe(t.managerA.membershipId);
      expect(row.released_at).toBeInstanceOf(Date);
    }
    const emails = await t.emails<{ status: string; error_code: string | null; attempts: number }>([
      a,
      b,
      c,
    ]);
    expect(emails).toHaveLength(2);
    expect(emails.every((row) => row.status === 'sent' && row.attempts === 1)).toBe(true);
    const ids = rows.map((row) => row.id);
    expect(await t.events('grants.decision.released', ids)).toHaveLength(2);
    const sentEvents = await t.events<{ entity_id: string }>(
      'grants.decision_email.sent',
      (
        await t.rows<{ id: string }>(
          'SELECT e.id FROM grants.decision_email e WHERE e.decision_id = ANY($1)',
          [ids],
        )
      ).map((row) => row.id),
    );
    expect(sentEvents).toHaveLength(2);

    // The applicant sees the outcome now, and the unrecorded one is still just submitted.
    expect(await application(a)).toMatchObject({
      status: 'awarded',
      outcome: { result: 'accepted', amount: pounds(15_000) },
    });
    expect(await application(b)).toMatchObject({
      status: 'not_funded',
      outcome: { result: 'declined' },
    });
    expect(await application(c)).toMatchObject({ outcome: null });
    const listed = await t.list(roundId);
    expect(listed.unsentEmails).toBe(0);
    expect(listed.submissions.find((row) => row.submissionId === a)).toMatchObject({
      email: 'sent',
      decision: { releasedAt: expect.any(String) as string },
    });
  });

  it('releases the chosen decisions only, all or none', async () => {
    const { roundId, a, b, c } = await aRound();
    await t.recorded(a, waitlisted);
    await t.recorded(b, declined);
    t.sent.length = 0;

    const refused = await t.release(roundId, { release: 'chosen', submissionIds: [a, c] });
    expect(refused.statusCode).toBe(409);
    expect(refused.json<Problem>().errors?.map((error) => error.field)).toEqual([
      'body.submissionIds.1',
    ]);
    expect(
      await t.decisions<{ released_at: Date | null }>(
        'd.application_id = ANY($1) AND d.released_at IS NOT NULL',
        [[a, b]],
      ),
    ).toEqual([]);
    expect(t.sent).toEqual([]);

    const result = await answer<ReleaseResult>(
      t.release(roundId, { release: 'chosen', submissionIds: [a] }),
    );
    expect(result).toEqual({ released: 1, sent: 1, failed: 0, pending: 0 });
    expect(await application(a)).toMatchObject({
      status: 'waitlisted',
      outcome: { result: 'waitlisted' },
    });
    expect(await application(b)).toMatchObject({ outcome: null });
  });

  it('never releases a withdrawn submission, and a release leaves nothing to release twice', async () => {
    const { roundId, a, b } = await aRound();
    await t.recorded(a, declined);
    await t.recorded(b, declined);
    await answer(t.send(t.ann, 'POST', t.path(b, '/withdraw')));
    t.sent.length = 0;

    expect((await t.release(roundId, { release: 'chosen', submissionIds: [b] })).statusCode).toBe(
      409,
    );
    expect(await answer<ReleaseResult>(t.release(roundId))).toEqual({
      released: 1,
      sent: 1,
      failed: 0,
      pending: 0,
    });
    expect(await answer<ReleaseResult>(t.release(roundId))).toEqual({
      released: 0,
      sent: 0,
      failed: 0,
      pending: 0,
    });
    expect(t.sent).toHaveLength(1);
  });

  it('fixes a released decision: no change, no withdrawal', async () => {
    const { roundId, a } = await aRound();
    await t.recorded(a, accepted(15_000));
    await answer(t.release(roundId));

    const changed = await t.record(a, declined);
    expect(changed.statusCode).toBe(409);
    expect(changed.json<Problem>().detail).toMatch(/released/);
    const bulk = await t.send(t.managerA, 'POST', t.roundPath(roundId), {
      decisions: [{ submissionId: a, decision: accepted(20_000) }],
    });
    expect(bulk.statusCode).toBe(409);
    const withdrawn = await t.send(t.ann, 'POST', t.path(a, '/withdraw'));
    expect(withdrawn.statusCode).toBe(409);
    expect(withdrawn.json<Problem>().detail).toMatch(/outcome/);

    const [row] = await t.decisions<{ outcome: string; amount_minor: string }>(
      'd.application_id = $1',
      [a],
    );
    expect(row).toMatchObject({ outcome: 'accepted', amount_minor: '1500000' });
    expect(await application(a)).toMatchObject({ status: 'awarded' });
  });

  it('refuses a reviewer and an applicant, even signed in again', async () => {
    const { roundId, a } = await aRound();
    await t.recorded(a, declined);
    t.sent.length = 0;
    const body = { release: 'all' };
    expect((await t.release(roundId, body, t.reviewerA)).statusCode).toBe(403);
    expect((await t.release(roundId, body, t.applicantA)).statusCode).not.toBe(200);
    expect(t.sent).toEqual([]);
  });
});

describe('another tenant', () => {
  it('cannot release or send, and reads exactly as a missing round', async () => {
    const { roundId, a } = await aRound();
    await t.recorded(a, declined);
    const nothing = randomUUID();

    expectLooksMissing(
      await t.release(roundId, undefined, t.managerB),
      await t.release(nothing, undefined, t.managerB),
    );
    expectLooksMissing(await t.resend(roundId, t.managerB), await t.resend(nothing, t.managerB));
    const chosen = await t.release(nothing, { release: 'chosen', submissionIds: [a] }, t.managerB);
    expect(chosen.statusCode).toBe(404);
    expect(
      (await t.decisions<{ released_at: Date | null }>('d.application_id = $1', [a]))[0]
        ?.released_at,
    ).toBeNull();
  });
});
