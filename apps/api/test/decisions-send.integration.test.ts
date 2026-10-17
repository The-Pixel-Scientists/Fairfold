// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Sending decision emails from the outbox through the whole API against the
// test database, as app_api (ADR 0020): after the release commits, through
// the real SMTP sender, with a failing server leaving the release in place
// and its emails failed with codes, a cap of 500 a request, and resend.

import { randomUUID } from 'node:crypto';

import type { EmailDelivery, ReleaseResult } from '@pixel-scientists/grants/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { addOrganisation } from '../../../packages/db/test/party/fixtures.ts';
import { asMigratorIn } from '../../../packages/db/test/tenants.ts';
import { createLogger } from '../src/logger.ts';
import { createSender, type Email } from '../src/email/sender.ts';
import { createSmtpTransport } from '../src/email/transport.ts';
import { accepted, declined, startDecisionsApi, type DecisionsApi } from './decisions-api.ts';
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

describe('sending through SMTP', () => {
  it('delivers each email to its applicant with the filled template and nothing else', async () => {
    const { roundId, email } = await recordedRound();

    const result = await stubbed({}, async (stub) => {
      const released = await answer<ReleaseResult>(t.release(roundId));
      expect(stub.messages.map((message) => message.to)).toEqual([[email], [email]]);
      const award = stub.messages.find((message) => message.data.includes('offering'));
      expect(award?.data).toContain('Subject: Community Spaces Fund: we are offering you a grant');
      expect(award?.data).toContain('Dear Ada,');
      expect(award?.data).toContain('15,000');
      expect(award?.data).toContain('Northfield Allotment Society');
      expect(award?.data).not.toMatch(/Cc:|Bcc:/i);
      return released;
    });

    expect(result).toEqual({ released: 2, sent: 2, failed: 0, pending: 0 });
  });

  it('leaves the release committed and each email failed with a code when the server is down', async () => {
    const { roundId, a, b } = await recordedRound();
    t.sendWith(smtpAt(await closedPort()));

    const result = await answer<ReleaseResult>(t.release(roundId));
    t.restore();

    expect(result).toEqual({ released: 2, sent: 0, failed: 2, pending: 0 });
    const released = await t.decisions<{ id: string; released_at: Date | null }>(
      'd.application_id = ANY($1)',
      [[a, b]],
    );
    expect(released.every((row) => row.released_at instanceof Date)).toBe(true);
    const emails = await t.emails<{ status: string; error_code: string; attempts: number }>([a, b]);
    expect(emails).toEqual([
      expect.objectContaining({ status: 'failed', error_code: 'connection_failed', attempts: 1 }),
      expect.objectContaining({ status: 'failed', error_code: 'connection_failed', attempts: 1 }),
    ]);
    const failed = await t.rows<{ id: string }>(
      'SELECT e.id FROM grants.decision_email e WHERE e.decision_id = ANY($1)',
      [released.map((row) => row.id)],
    );
    expect(
      await t.events(
        'grants.decision_email.failed',
        failed.map((row) => row.id),
      ),
    ).toHaveLength(2);
    expect((await t.list(roundId)).unsentEmails).toBe(2);
  });

  it('records the code of a refused address, and sends again on request', async () => {
    const { roundId, a, b, email } = await recordedRound();
    await stubbed({ refuse: 'RCPT' }, async () => {
      const result = await answer<ReleaseResult>(t.release(roundId));
      expect(result).toMatchObject({ released: 2, sent: 0, failed: 2 });
    });
    expect(await t.emails<{ error_code: string }>([a, b])).toEqual([
      expect.objectContaining({ error_code: 'recipient_refused' }),
      expect.objectContaining({ error_code: 'recipient_refused' }),
    ]);

    await stubbed({}, async (stub) => {
      const again = await answer<EmailDelivery>(t.resend(roundId));
      expect(again).toEqual({ sent: 2, failed: 0, pending: 0 });
      expect(stub.messages.map((message) => message.to)).toEqual([[email], [email]]);
    });

    expect(await t.emails<{ status: string; error_code: null; attempts: number }>([a, b])).toEqual([
      expect.objectContaining({ status: 'sent', error_code: null, attempts: 2 }),
      expect.objectContaining({ status: 'sent', error_code: null, attempts: 2 }),
    ]);
    const ids = (
      await t.rows<{ id: string }>(
        'SELECT e.id FROM grants.decision_email e JOIN grants.decision d ON d.id = e.decision_id WHERE d.application_id = ANY($1)',
        [[a, b]],
      )
    ).map((row) => row.id);
    expect(await t.events('grants.decision_email.resent', ids)).toHaveLength(2);
    expect((await t.list(roundId)).unsentEmails).toBe(0);

    // Nothing is left to send, so sending again sends nothing.
    t.sent.length = 0;
    expect(await answer<EmailDelivery>(t.resend(roundId))).toEqual({
      sent: 0,
      failed: 0,
      pending: 0,
    });
    expect(t.sent).toEqual([]);
  });
});

describe('the outbox', () => {
  it('sends only for a decision whose release event exists', async () => {
    const { roundId, a } = await recordedRound();
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

    const result = await answer<EmailDelivery>(t.resend(roundId));

    expect(result).toEqual({ sent: 0, failed: 0, pending: 1 });
    expect(t.sent).toEqual([]);
    expect(await t.emails<{ status: string }>([a])).toEqual([
      expect.objectContaining({ status: 'pending' }),
    ]);
  });

  it('sends at most 500 a request, and the rest on the next', async () => {
    const round = await t.reviewRound();
    const first = await t.submission(round);
    await t.recorded(first, declined);
    // 500 more submitted applications of new organisations, each with a recorded decision.
    await asMigratorIn(t.tenantA.id, async (client) => {
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
      const ids = rows.map((row) => row.id);
      await client.query(
        "UPDATE grants.application SET status = 'submitted', stage_id = $2 WHERE id = ANY($1)",
        [ids, round.review.id],
      );
      await client.query(
        `INSERT INTO grants.decision
           (tenant_id, application_id, outcome, recorded_by, created_by, updated_by)
         SELECT app.current_tenant_id(), i, 'declined', $2, $2, $2
           FROM unnest($1::uuid[]) AS i`,
        [ids, t.managerA.membershipId],
      );
    });
    t.sent.length = 0;

    const released = await answer<ReleaseResult>(t.release(round.open.round.id));

    expect(released).toEqual({ released: 501, sent: 500, failed: 0, pending: 1 });
    expect(t.sent).toHaveLength(500);
    expect(await answer<EmailDelivery>(t.resend(round.open.round.id))).toEqual({
      sent: 1,
      failed: 0,
      pending: 0,
    });
  }, 300_000);
});
