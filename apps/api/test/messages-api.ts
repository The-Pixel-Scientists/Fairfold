// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Notes and messages for integration tests: the decisions API (a mail sender
// the tests control, submissions an applicant has made, reviewers) with the
// message notification job run as the worker would run it.

import { randomUUID } from 'node:crypto';

import { withTenant } from '@pixel-scientists/db';
import type {
  ApplicantMessage,
  ApplicantThread,
  StaffMessage,
  StaffThread,
} from '@pixel-scientists/domain/notes';

import { trustedTenantId } from '../../../packages/db/src/tenant-context.ts';
import type { TestTenant } from '../../../packages/db/test/tenants.ts';
import { messageNotificationJob } from '../src/message-notifications.ts';
import { startDecisionsApi, PORTAL } from './decisions-api.ts';
import { answer, rowsOf } from './programme-api.ts';
import type { Member } from './settings-api.ts';

/** Plainly synthetic text that no email, log or audit event may repeat. */
export const MESSAGE = 'Synthetic funder message: the roof survey is overdue';
export const REPLY = 'Synthetic applicant reply: the survey is booked';
export const NOTE = 'Synthetic staff note: call the chair before the panel';

export async function startMessagesApi(port: string) {
  const t = await startDecisionsApi(port);
  const { handler } = messageNotificationJob({ sender: t.mail.sender, portalOrigin: PORTAL });

  /** A submission by `applicant`, whose person has a name and an address. */
  async function submitted(applicant: Member = t.ann, email = `ada-${randomUUID()}@example.org`) {
    const round = await t.reviewRound();
    const id = await t.submission(round, applicant);
    await t.personOf(applicant, 'Ada', email);
    return { round, id, email };
  }

  const staffPath = (id: string, tail = '') => `/console/submissions/${id}/messages${tail}`;
  const mine = (id: string, tail = '') => `/portal/applications/${id}/messages${tail}`;
  const notesPath = (id: string) => `/console/submissions/${id}/notes`;

  const sendStaff = (id: string, body: string, member: Member = t.managerA, key?: string) =>
    t.send(member, 'POST', staffPath(id), { body }, 'console', null, key);
  const sendApplicant = (id: string, body: string, member: Member = t.ann, key?: string) =>
    t.send(member, 'POST', mine(id), { body }, 'portal', null, key);
  const staffThread = (id: string, member: Member = t.managerA) =>
    answer<StaffThread>(t.send(member, 'GET', staffPath(id)));
  const applicantThread = (id: string, member: Member = t.ann) =>
    answer<ApplicantThread>(t.send(member, 'GET', mine(id)));
  const staffSent = (id: string, body = MESSAGE) => answer<StaffMessage>(sendStaff(id, body), 201);
  const applicantSent = (id: string, body = REPLY) =>
    answer<ApplicantMessage>(sendApplicant(id, body), 201);

  /** One notification job, as the worker's wrapper would run it: in `tenantId`, as app_worker. */
  const runNotification = (
    tenantId: string,
    job: { id?: string; notificationId: string; requestId?: string },
    crashAfter = false,
  ) =>
    withTenant(t.worker, trustedTenantId(tenantId), async (trx) => {
      await handler(trx, {
        id: job.id ?? randomUUID(),
        data: { notificationId: job.notificationId },
        context: {
          sender: t.jobs,
          requestId: job.requestId ?? randomUUID(),
          causingUserId: null,
        },
      });
      if (crashAfter) throw new Error('The worker stopped before it committed.');
    });

  /** The notification rows of these applications' threads, oldest first. */
  const notifications = (applicationIds: string[]) =>
    t.rows<{
      id: string;
      status: string;
      error_code: string | null;
      recipient_person_id: string | null;
      sent_at: Date | null;
    }>(
      `SELECT n.id, n.status, n.error_code, n.recipient_person_id, n.sent_at
         FROM grants.message_notification n
         JOIN app.message m ON m.id = n.message_id
         JOIN grants.application_message l ON l.thread_id = m.thread_id
        WHERE l.application_id = ANY($1) ORDER BY n.created_at, n.id`,
      [applicationIds],
    );

  /** The jobs waiting for these applications' notifications. */
  const waiting = (applicationIds: string[]) =>
    t.rows<{ id: string; data: Record<string, string | null> }>(
      `SELECT j.id, j.data FROM pgboss.job j
        WHERE j.name = 'grants.message_notification' AND j.state = 'created'
          AND j.data->>'notificationId' IN (
            SELECT n.id::text FROM grants.message_notification n
              JOIN app.message m ON m.id = n.message_id
              JOIN grants.application_message l ON l.thread_id = m.thread_id
             WHERE l.application_id = ANY($1))
        ORDER BY j.created_on, j.id`,
      [applicationIds],
    );

  const eventsOf = <T extends object>(
    action: string,
    entityId: string,
    tenant: TestTenant = t.tenantA,
  ) =>
    rowsOf<T>(
      tenant,
      `SELECT action, entity_id, actor_id, subject_party_id, changes FROM app.audit_event
        WHERE action = $1 AND entity_id = $2 ORDER BY occurred_at, id`,
      [action, entityId],
    );

  return {
    ...t,
    submitted,
    staffPath,
    mine,
    notesPath,
    sendStaff,
    sendApplicant,
    staffThread,
    applicantThread,
    staffSent,
    applicantSent,
    runNotification,
    notifications,
    waiting,
    eventsOf,
  };
}

export type MessagesApi = Awaited<ReturnType<typeof startMessagesApi>>;
