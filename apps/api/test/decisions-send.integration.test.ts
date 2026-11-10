// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Sending decision emails from the outbox against the test database (ADR 0009,
// ADR 0020): release and resend queue one job per email as app_api, and the
// release email job sends them as app_worker through the real SMTP sender,
// with a failing server leaving the release in place, retries, resend, the
// job's own checks, and another tenant's reach.

import { randomUUID } from 'node:crypto';

import { JobError } from '@pixel-scientists/db/jobs';
import type { EmailDelivery, ReleaseResult } from '@pixel-scientists/grants/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { addOrganisation } from '../../../packages/db/test/party/fixtures.ts';
import { asMigratorIn } from '../../../packages/db/test/tenants.ts';
import { createLogger } from '../src/logger.ts';
import { createSender, type Email } from '../src/email/sender.ts';
import { createSmtpTransport } from '../src/email/transport.ts';
import { declined, accepted, startDecisionsApi, type DecisionsApi } from './decisions-api.ts';
import { switchModule } from './modules-on.ts';
import { answer } from './programme-api.ts';
import { closedPort, startStub, type StubOptions } from './smtp-stub.ts';

// Each request runs a few statements in a transaction, which is slow on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

let t: DecisionsApi;

beforeAll(async () => {
  t = await startDecisionsApi('41052');
}, 60_000);

afterAll(async () => {
  await t.close();
});

/** The real sender and SMTP client, pointed at a loopback port. */
const smtpAt = (port: number) => {
  const sender = createSender(
    { from: 'grants@example.org' },
    createLogger({ level: 'silent' }),
    createSmtpTransport({ host: '127.0.0.1', port, tls: 'none', from: 'grants@example.org' }),
  );
  return (email: Email) => sender.send(email);
};

async function stubbed<T>(
  options: StubOptions,
  run: (stub: Awaited<ReturnType<typeof startStub>>) => Promise<T>,
) {
  const stub = await startStub(options);
  try {
    t.sendWith(smtpAt(stub.port));
    return await run(stub);
  } finally {
    t.restore();
    await stub.close();
  }
}

/** A round with two recorded decisions, the applicant with an address of her own. */
async function recordedRound() {
  const round = await t.reviewRound();
  const [a, b] = [await t.submission(round), await t.submission(round)];
  const email = `ada-${randomUUID()}@example.org`;
  await t.personOf(t.ann, 'Ada', email);
  await t.recorded(a, accepted(15_000));
  await t.recorded(b, declined);
  return { round, roundId: round.open.round.id, a, b, email };
}

/** A recorded round, released: its emails are queued and nothing is sent yet. */
async function releasedRound() {
  const recorded = await recordedRound();
  const released = await answer<ReleaseResult>(t.release(recorded.roundId));
  return { ...recorded, released };
}

const emailRows = (applicationIds: string[]) =>
  t.emails<{ status: string; error_code: string | null; attempts: number }>(applicationIds);

const emailIds = async (applicationIds: string[]) =>
  (
    await t.rows<{ id: string }>(
      `SELECT e.id FROM grants.decision_email e JOIN grants.decision d ON d.id = e.decision_id
        WHERE d.application_id = ANY($1)`,
      [applicationIds],
    )
  ).map((row) => row.id);

const jobEvents = (action: string, ids: string[]) =>
  t.rows<{
    actor_kind: string;
    actor_id: string | null;
    job_id: string | null;
    origin_membership_id: string | null;
    changes: unknown;
  }>(
    `SELECT actor_kind, actor_id, job_id, origin_membership_id, changes FROM app.audit_event
      WHERE action = $1 AND entity_id = ANY($2)`,
    [action, ids],
  );

describe('queuing the emails', () => {
  it('queues one job per email, holding ids only, and releases without waiting for mail', async () => {
    const { roundId, a, b } = await recordedRound();
    let called = false;
    t.sendWith(() => {
      called = true;
      return new Promise(() => undefined);
    });

    const released = await answer<ReleaseResult>(t.release(roundId));
    t.restore();

    expect(released).toEqual({ released: 2, sent: 0, failed: 0, pending: 2 });
    expect(called).toBe(false);
    const jobs = await t.queued([a, b]);
    expect(jobs).toHaveLength(2);
    expect(new Set(jobs.map((job) => job.data['decisionEmailId']))).toEqual(
      new Set(await emailIds([a, b])),
    );
    for (const { data } of jobs) {
      expect(Object.keys(data).sort()).toEqual([
        'causingUserId',
        'decisionEmailId',
        'requestId',
        'tenantId',
      ]);
      expect(data).toMatchObject({
        tenantId: t.tenantA.id,
        causingUserId: t.managerA.membershipId,
      });
    }
    expect(await emailRows([a, b])).toEqual([
      expect.objectContaining({ status: 'pending', attempts: 0 }),
      expect.objectContaining({ status: 'pending', attempts: 0 }),
    ]);
    const keys = await t.rows<{ singleton_key: string }>(
      'SELECT singleton_key FROM pgboss.job WHERE id = ANY($1)',
      [jobs.map((job) => job.id)],
    );
    for (const id of await emailIds([a, b])) {
      expect(keys.some((row) => row.singleton_key.includes(id))).toBe(true);
    }
  });

  it('queues nothing when the release is refused', async () => {
    const { roundId, a, b } = await recordedRound();
    const before = (await t.rows('SELECT id FROM pgboss.job')).length;

    const refused = await t.release(roundId, {
      release: 'chosen',
      submissionIds: [a, randomUUID()],
    });

    expect(refused.statusCode).toBe(409);
    expect((await t.rows('SELECT id FROM pgboss.job')).length).toBe(before);
    expect(await t.queued([a, b])).toEqual([]);
  });

  it('queues one job per email for more than 500 decisions in a round', async () => {
    const round = await t.reviewRound();
    const first = await t.submission(round);
    await t.recorded(first, declined);
    // 500 more submitted applications of new organisations, each with a recorded decision.
    const ids = await asMigratorIn(t.tenantA.id, async (client) => {
      const organisations: string[] = [];
      for (let index = 0; index < 500; index++) {
        organisations.push(await addOrganisation(client, t.tenantA));
      }
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO grants.application
           (tenant_id, round_id, form_version_id, applicant_person_id, organisation_id, created_by, updated_by)
         SELECT a.tenant_id, a.round_id, a.form_version_id, a.applicant_person_id, o,
                a.created_by, a.updated_by
           FROM grants.application a, unnest($2::uuid[]) AS o
          WHERE a.id = $1
         RETURNING id`,
        [first, organisations],
      );
      const added = rows.map((row) => row.id);
      await client.query(
        "UPDATE grants.application SET status = 'submitted', stage_id = $2 WHERE id = ANY($1)",
        [added, round.review.id],
      );
      await client.query(
        `INSERT INTO grants.decision
           (tenant_id, application_id, outcome, recorded_by, created_by, updated_by)
         SELECT app.current_tenant_id(), i, 'declined', $2, $2, $2
           FROM unnest($1::uuid[]) AS i`,
        [added, t.managerA.membershipId],
      );
      return [first, ...added];
    });

    const released = await answer<ReleaseResult>(t.release(round.open.round.id));

    expect(released).toEqual({ released: 501, sent: 0, failed: 0, pending: 501 });
    const jobs = await t.queued(ids);
    expect(jobs).toHaveLength(501);
    expect(new Set(jobs.map((job) => job.data['decisionEmailId'])).size).toBe(501);
    await t.rows('DELETE FROM pgboss.job WHERE id = ANY($1)', [jobs.map((job) => job.id)]);
  }, 300_000);
});

describe('sending through SMTP', () => {
  it('delivers each email to its applicant with the filled template and nothing else', async () => {
    const { a, b, email } = await releasedRound();
    const jobIds = (await t.queued([a, b])).map((job) => job.id);

    await stubbed({}, async (stub) => {
      expect(await t.deliver([a, b])).toEqual({ ran: 2, failed: 0 });
      expect(stub.messages.map((message) => message.to)).toEqual([[email], [email]]);
      const award = stub.messages.find((message) => message.data.includes('offering'));
      expect(award?.data).toContain('Subject: Community Spaces Fund: we are offering you a grant');
      expect(award?.data).toContain('Dear Ada,');
      expect(award?.data).toContain('15,000');
      expect(award?.data).toContain('Northfield Allotment Society');
      expect(award?.data).not.toMatch(/Cc:|Bcc:/i);
    });

    expect(await emailRows([a, b])).toEqual([
      expect.objectContaining({ status: 'sent', error_code: null, attempts: 1 }),
      expect.objectContaining({ status: 'sent', error_code: null, attempts: 1 }),
    ]);
    expect(await t.queued([a, b])).toEqual([]);
    // Each event is the system acting for the releasing member, with the job's id, and no personal data.
    const events = await jobEvents('grants.decision_email.sent', await emailIds([a, b]));
    expect(events).toHaveLength(2);
    for (const event of events) {
      expect(event).toMatchObject({
        actor_kind: 'system',
        actor_id: null,
        origin_membership_id: t.managerA.membershipId,
      });
      expect(jobIds).toContain(event.job_id);
      expect(JSON.stringify(event.changes)).not.toMatch(/@|Ada|Northfield/);
    }
  });

  it('queues no second job when a resend finds the email still waiting, and sends once', async () => {
    const { roundId, a, b } = await releasedRound();

    expect(await answer<EmailDelivery>(t.resend(roundId))).toEqual({
      sent: 0,
      failed: 0,
      pending: 2,
    });
    await answer<EmailDelivery>(t.resend(roundId));

    const jobs = await t.queued([a, b]);
    expect(jobs).toHaveLength(2);
    expect(new Set(jobs.map((job) => job.data['decisionEmailId'])).size).toBe(2);
    // Nothing was queued, so nothing is recorded as resent.
    expect(await t.events('grants.decision_email.resent', await emailIds([a, b]))).toEqual([]);

    await stubbed({}, async (stub) => {
      await t.deliver([a, b]);
      expect(stub.messages).toHaveLength(2);
    });
    expect(await emailRows([a, b])).toEqual([
      expect.objectContaining({ status: 'sent', attempts: 1 }),
      expect.objectContaining({ status: 'sent', attempts: 1 }),
    ]);
  });

  it('keeps the release when the server is down, and sends on the retry', async () => {
    const { roundId, a, b } = await releasedRound();
    t.sendWith(smtpAt(await closedPort()));

    const down = await t.deliver([a, b]);
    t.restore();

    expect(down).toEqual({ ran: 0, failed: 2 });
    const released = await t.decisions<{ released_at: Date | null }>('d.application_id = ANY($1)', [
      [a, b],
    ]);
    expect(released.every((row) => row.released_at instanceof Date)).toBe(true);
    expect(await emailRows([a, b])).toEqual([
      expect.objectContaining({ status: 'pending', attempts: 0 }),
      expect.objectContaining({ status: 'pending', attempts: 0 }),
    ]);
    expect(await t.queued([a, b])).toHaveLength(2);
    expect((await t.list(roundId)).unsentEmails).toBe(2);

    await stubbed({}, async () => {
      expect(await t.deliver([a, b])).toEqual({ ran: 2, failed: 0 });
    });
    expect(await emailRows([a, b])).toEqual([
      expect.objectContaining({ status: 'sent', attempts: 1 }),
      expect.objectContaining({ status: 'sent', attempts: 1 }),
    ]);
    expect((await t.list(roundId)).unsentEmails).toBe(0);
  });

  it('fails a job with a code only, naming no address', async () => {
    const { a, email } = await releasedRound();
    const [id] = await emailIds([a]);
    t.sendWith(smtpAt(await closedPort()));

    const failure: unknown = await t
      .runJob(t.tenantA.id, { decisionEmailId: id ?? '' })
      .catch((error: unknown) => error);
    t.restore();

    expect(failure).toBeInstanceOf(JobError);
    expect((failure as JobError).code).toBe('internal');
    expect(String(failure)).not.toContain(email);
  });

  it('records the code of a refused address, and sends again on request', async () => {
    const { roundId, a, b, email } = await releasedRound();
    await stubbed({ refuse: 'RCPT' }, async () => {
      expect(await t.deliver([a, b])).toEqual({ ran: 2, failed: 0 });
    });
    expect(await emailRows([a, b])).toEqual([
      expect.objectContaining({ status: 'failed', error_code: 'recipient_refused', attempts: 1 }),
      expect.objectContaining({ status: 'failed', error_code: 'recipient_refused', attempts: 1 }),
    ]);
    const ids = await emailIds([a, b]);
    expect(await jobEvents('grants.decision_email.failed', ids)).toHaveLength(2);
    expect((await t.list(roundId)).unsentEmails).toBe(2);
    expect(await t.queued([a, b])).toEqual([]);

    expect(await answer<EmailDelivery>(t.resend(roundId))).toEqual({
      sent: 0,
      failed: 0,
      pending: 2,
    });
    expect(await t.events('grants.decision_email.resent', ids)).toHaveLength(2);
    expect(await t.queued([a, b])).toHaveLength(2);
    await stubbed({}, async (stub) => {
      expect(await t.deliver([a, b])).toEqual({ ran: 2, failed: 0 });
      expect(stub.messages.map((message) => message.to)).toEqual([[email], [email]]);
    });
    expect(await emailRows([a, b])).toEqual([
      expect.objectContaining({ status: 'sent', error_code: null, attempts: 2 }),
      expect.objectContaining({ status: 'sent', error_code: null, attempts: 2 }),
    ]);
    expect((await t.list(roundId)).unsentEmails).toBe(0);

    // Nothing is left to send, so resending queues nothing.
    t.sent.length = 0;
    expect(await answer<EmailDelivery>(t.resend(roundId))).toEqual({
      sent: 0,
      failed: 0,
      pending: 0,
    });
    expect(await t.queued([a, b])).toEqual([]);
    expect(t.sent).toEqual([]);
  });

  it('sends again after a crash between the mail server and the commit, and ends sent', async () => {
    const { a, b } = await releasedRound();
    t.sent.length = 0;

    expect(await t.deliver([a, b], true)).toEqual({ ran: 0, failed: 2 });
    expect(t.sent).toHaveLength(2);
    expect(await emailRows([a, b])).toEqual([
      expect.objectContaining({ status: 'pending', attempts: 0 }),
      expect.objectContaining({ status: 'pending', attempts: 0 }),
    ]);

    expect(await t.deliver([a, b])).toEqual({ ran: 2, failed: 0 });
    expect(t.sent).toHaveLength(4);
    expect(await emailRows([a, b])).toEqual([
      expect.objectContaining({ status: 'sent', attempts: 1 }),
      expect.objectContaining({ status: 'sent', attempts: 1 }),
    ]);

    // A job that runs again after the email is sent sends nothing.
    const [id] = await emailIds([a]);
    await t.runJob(t.tenantA.id, { decisionEmailId: id ?? '' });
    expect(t.sent).toHaveLength(4);
  });
});

describe('the job checks the database, not the job', () => {
  it('fails an email whose decision has no release event, and sends nothing', async () => {
    const { a } = await recordedRound();
    // Released and queued by hand, as the migrator, so no release event was written.
    await asMigratorIn(t.tenantA.id, async (client) => {
      await client.query('UPDATE grants.decision SET released_by = $2 WHERE application_id = $1', [
        a,
        t.managerA.membershipId,
      ]);
      await client.query(
        `INSERT INTO grants.decision_email
           (tenant_id, decision_id, recipient_person_id, template_version_id, created_by, updated_by)
         SELECT d.tenant_id, d.id, p.applicant_person_id,
                (SELECT t.id FROM grants.email_template_version t
                  WHERE t.programme_id = r.programme_id AND t.outcome = d.outcome
                  ORDER BY t.version DESC LIMIT 1), $2, $2
           FROM grants.decision d
           JOIN grants.application p ON p.id = d.application_id
           JOIN grants.round r ON r.id = p.round_id
          WHERE d.application_id = $1`,
        [a, t.managerA.membershipId],
      );
    });
    t.sent.length = 0;
    const [id] = await emailIds([a]);

    await t.runJob(t.tenantA.id, { decisionEmailId: id ?? '' });

    expect(t.sent).toEqual([]);
    expect(await emailRows([a])).toEqual([
      expect.objectContaining({ status: 'failed', error_code: 'failed', attempts: 1 }),
    ]);
    expect(await jobEvents('grants.decision_email.failed', [id ?? ''])).toHaveLength(1);
  });

  it('sends nothing while grants is off for the tenant, and the email stays waiting', async () => {
    const { a, b } = await releasedRound();
    t.sent.length = 0;
    await switchModule(t.tenantA, 'grants', false);
    try {
      expect(await t.deliver([a, b])).toEqual({ ran: 2, failed: 0 });
    } finally {
      await switchModule(t.tenantA, 'grants');
    }

    expect(t.sent).toEqual([]);
    expect(await emailRows([a, b])).toEqual([
      expect.objectContaining({ status: 'pending', attempts: 0 }),
      expect.objectContaining({ status: 'pending', attempts: 0 }),
    ]);
  });

  it('refuses a job that does not hold exactly one email id', async () => {
    for (const decisionEmailId of ['not an id', '']) {
      const failure: unknown = await t
        .runJob(t.tenantA.id, { decisionEmailId })
        .catch((error: unknown) => error);
      expect(failure).toMatchObject({ code: 'invalid_payload' });
    }
  });

  it("finds nothing of another tenant's email, and sends nothing", async () => {
    const { a } = await releasedRound();
    t.sent.length = 0;
    const [id] = await emailIds([a]);

    const failure: unknown = await t
      .runJob(t.tenantB.id, { decisionEmailId: id ?? '' })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(JobError);
    expect((failure as JobError).code).toBe('not_found');
    expect(t.sent).toEqual([]);
    expect(await emailRows([a])).toEqual([expect.objectContaining({ status: 'pending' })]);
  });
});
