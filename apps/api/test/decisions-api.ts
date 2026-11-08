// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The decision routes for integration tests: the assessment API with a mail
// sender the tests control, rounds with submissions in their review stage,
// and the requests the tests share.

import { randomUUID } from 'node:crypto';

import { createDatabase, withTenant } from '@pixel-scientists/db';
import type { DecisionList, Decision } from '@pixel-scientists/grants/contracts';

import { trustedTenantId } from '../../../packages/db/src/tenant-context.ts';
import { databaseSettings } from '../../../packages/db/test/connect.ts';
import { asMigratorIn } from '../../../packages/db/test/tenants.ts';
import { releaseEmailJob } from '../src/decision-emails.ts';
import type { Email, SendResult } from '../src/email/sender.ts';
import type { Mail } from '../src/modules.ts';
import { startAssessmentApi } from './assessment-api.ts';
import { answer, type Money } from './programme-api.ts';
import type { Member } from './settings-api.ts';

export const PORTAL = 'https://portal.example.org';

export const pounds = (amount: number): Money => ({ amountMinor: amount * 100, currency: 'GBP' });

export const accepted = (amount = 15_000) => ({ outcome: 'accepted', amount: pounds(amount) });
export const declined = { outcome: 'declined' } as const;
export const waitlisted = { outcome: 'waitlisted' } as const;

type Send = (email: Email) => Promise<SendResult>;

export async function startDecisionsApi(port: string) {
  const sent: Email[] = [];
  const recording: Send = (email) => {
    sent.push(email);
    return Promise.resolve({ sent: true });
  };
  let behaviour: Send = recording;
  const mail: Mail = { sender: { send: (email) => behaviour(email) }, portalOrigin: PORTAL };
  const t = await startAssessmentApi(port, mail);
  const settings = databaseSettings('app_worker', 4);
  const worker = createDatabase<unknown>({
    host: settings.host,
    port: settings.port,
    database: settings.database,
    password: settings.password,
    role: 'app_worker',
    maxConnections: 4,
    applicationName: 'tps-db-tests',
  });
  const { handler } = releaseEmailJob({ sender: mail.sender, portalOrigin: PORTAL });

  /** Changes what sending does until `restore()`: a real or failing sender, say. */
  const sendWith = (send: Send) => {
    behaviour = send;
  };
  const restore = () => {
    behaviour = recording;
  };

  /** A person record for the applicant, as the application routes made it, with a name and address. */
  const personOf = (member: Member, givenName: string, email: string) =>
    asMigratorIn(member.tenant.id, (client) =>
      client
        .query('UPDATE party.person SET given_name = $2, email = $3 WHERE user_id = $1', [
          member.userId,
          givenName,
          email,
        ])
        .then(() => undefined),
    );

  /** One release email job, as the worker's wrapper would run it: in `tenantId`, as app_worker. */
  const runJob = (
    tenantId: string,
    job: {
      id?: string;
      decisionEmailId: string;
      requestId?: string;
      causingUserId?: string | null;
    },
    crashAfter = false,
  ) =>
    withTenant(worker, trustedTenantId(tenantId), async (trx) => {
      await handler(trx, {
        id: job.id ?? randomUUID(),
        data: { decisionEmailId: job.decisionEmailId },
        context: {
          sender: t.jobs,
          requestId: job.requestId ?? randomUUID(),
          causingUserId: job.causingUserId ?? null,
        },
      });
      if (crashAfter) throw new Error('The worker stopped before it committed.');
    });

  /** The jobs queued for the emails of these applications' decisions, oldest first. */
  const queued = (applicationIds: string[]) =>
    t.rows<{ id: string; data: Record<string, string | null> }>(
      `SELECT j.id, j.data FROM pgboss.job j
        WHERE j.name = 'grants.release_email' AND j.state = 'created'
          AND j.data->>'decisionEmailId' IN (
            SELECT e.id::text FROM grants.decision_email e
              JOIN grants.decision d ON d.id = e.decision_id
             WHERE d.application_id = ANY($1))
        ORDER BY j.created_on, j.id`,
      [applicationIds],
    );

  /**
   * Runs the jobs queued for these applications' emails, as the worker does. A job that completes
   * is taken off the queue; one that fails stays, as pg-boss would keep it for a retry.
   */
  const deliver = async (applicationIds: string[], crashAfter = false) => {
    const result = { ran: 0, failed: 0 };
    for (const { id, data } of await queued(applicationIds)) {
      try {
        await runJob(
          data['tenantId'] ?? '',
          {
            id,
            decisionEmailId: data['decisionEmailId'] ?? '',
            requestId: data['requestId'] ?? undefined,
            causingUserId: data['causingUserId'] ?? null,
          },
          crashAfter,
        );
        await t.rows('DELETE FROM pgboss.job WHERE id = $1', [id]);
        result.ran++;
      } catch {
        result.failed++;
      }
    }
    return result;
  };

  const decisionPath = (submissionId: string) => `/console/submissions/${submissionId}/decision`;
  const roundPath = (roundId: string, tail = '') => `/console/rounds/${roundId}/decisions${tail}`;

  const record = (submissionId: string, decision: object, member: Member = t.managerA) =>
    t.send(member, 'PUT', decisionPath(submissionId), decision);

  const recorded = (submissionId: string, decision: object) =>
    answer<Decision>(record(submissionId, decision));

  /** A request that needs a recent sign-in, made with one. */
  const asFresh = (member: Member, method: 'POST', url: string, payload?: unknown) =>
    t.send(member, method, url, payload, member.app, new Date());

  const release = (roundId: string, body: object = { release: 'all' }, member = t.managerA) =>
    asFresh(member, 'POST', roundPath(roundId, '/release'), body);

  const resend = (roundId: string, member = t.managerA) =>
    asFresh(member, 'POST', `/console/rounds/${roundId}/decision-emails/send`);

  const list = (roundId: string, member = t.managerA) =>
    answer<DecisionList>(t.send(member, 'GET', roundPath(roundId)));

  /** The decision rows of a tenant, as the migrator sees them. */
  const decisions = <T extends object>(where = 'true', values: unknown[] = []) =>
    t.rows<T>(
      `SELECT d.id, d.application_id, d.outcome, d.amount_minor, d.released_at, d.released_by
         FROM grants.decision d WHERE ${where} ORDER BY d.created_at, d.id`,
      values,
    );

  const emails = <T extends object>(applicationIds: string[]) =>
    t.rows<T>(
      `SELECT e.status, e.error_code, e.attempts, e.recipient_person_id, d.application_id
         FROM grants.decision_email e JOIN grants.decision d ON d.id = e.decision_id
        WHERE d.application_id = ANY($1) ORDER BY d.application_id`,
      [applicationIds],
    );

  const events = <T extends object>(action: string, entityIds: string[]) =>
    t.rows<T>(
      `SELECT action, entity_id, actor_id, changes FROM app.audit_event
        WHERE action = $1 AND entity_id = ANY($2) ORDER BY occurred_at, id`,
      [action, entityIds],
    );

  return {
    ...t,
    mail,
    worker,
    sent,
    sendWith,
    restore,
    personOf,
    decisionPath,
    roundPath,
    record,
    recorded,
    release,
    resend,
    list,
    decisions,
    emails,
    events,
    runJob,
    queued,
    deliver,
    async close() {
      await t.close();
      await worker.destroy();
    },
  };
}

export type DecisionsApi = Awaited<ReturnType<typeof startDecisionsApi>>;
