// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The decision routes for integration tests: the assessment API with a mail
// sender the tests control, rounds with submissions in their review stage,
// and the requests the tests share.

import type { DecisionList, Decision } from '@pixel-scientists/grants/contracts';

import { asMigratorIn } from '../../../packages/db/test/tenants.ts';
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
  };
}

export type DecisionsApi = Awaited<ReturnType<typeof startDecisionsApi>>;
