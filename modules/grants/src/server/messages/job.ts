// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Sending one message notification for the worker's job (ADR 0009, ADR 0033).
// The job holds an outbox row's id, and everything else is read here, in the
// job's own tenant transaction as app_worker. This locks the row, leaves a
// row that is no longer queued alone, checks the message and its application
// still exist, reads the applicant's address through party's contact details,
// sends the fixed email (email.ts) and marks the row sent or failed with a
// code, never a message. The message's text is never read. A connection that
// fails or times out is left for the job to try again, and the row stays
// queued. Delivery is at least once: a crash between the mail server
// accepting the email and the commit sends it again on the retry. Nothing
// here changes an application or a decision (rule 9).

import { contactDetails } from '@pixel-scientists/party/server';

import type { DecisionEmailErrorCode } from '../../contracts/index.ts';
import type { MailSender } from '../decisions/context.ts';
import { noteDb } from '../notes/tables.ts';
import type { Tx } from '../programme/tables.ts';
import { messageEmail } from './email.ts';

/** The failures worth another try: the mail server was not reached, or did not answer in time. */
const TRANSIENT: ReadonlySet<DecisionEmailErrorCode> = new Set(['connection_failed', 'timeout']);

export interface MessageNotificationDependencies {
  readonly sender: MailSender;
  /** The applicant portal's origin, which the emails link to. */
  readonly portalOrigin: string;
}

export interface MessageNotificationJob {
  readonly notificationId: string;
  readonly requestId: string;
}

/**
 * `sent` or `failed`: the row was marked. `skipped`: grants is off, or the row was already
 * handled. `retry`: the mail server could not be reached. `missing`: no such row in this tenant,
 * or its message or application is gone.
 */
export type MessageNotificationOutcome = 'sent' | 'failed' | 'skipped' | 'retry' | 'missing';

export function sendMessageNotification(deps: MessageNotificationDependencies) {
  return async (tx: Tx, job: MessageNotificationJob): Promise<MessageNotificationOutcome> => {
    const db = noteDb(tx);
    // A module that is off keeps its data and sends nothing; the row stays queued (ADR 0024).
    const grants = await db
      .selectFrom('app.tenant_module')
      .select('enabled')
      .where('module', '=', 'grants')
      .executeTakeFirst();
    if (grants?.enabled !== true) return 'skipped';

    const row = await db
      .selectFrom('grants.message_notification as n')
      .innerJoin('app.message as m', 'm.id', 'n.message_id')
      .innerJoin('grants.application_message as l', 'l.thread_id', 'm.thread_id')
      .innerJoin('grants.application as a', 'a.id', 'l.application_id')
      .select(['n.status', 'n.recipient_person_id', 'a.id as application_id'])
      .where('n.id', '=', job.notificationId)
      .forUpdate('n')
      .executeTakeFirst();
    if (row === undefined) return 'missing';
    if (row.status !== 'queued') return 'skipped';

    let code: DecisionEmailErrorCode | undefined;
    const contact =
      row.recipient_person_id === null ? null : await contactDetails(tx, row.recipient_person_id);
    if (contact === null) {
      code = 'no_address';
    } else {
      const email = messageEmail({
        givenName: contact.givenName,
        portalOrigin: deps.portalOrigin,
        applicationId: row.application_id,
      });
      const sent = await deps.sender.send({
        to: contact.email,
        subject: email.subject,
        text: email.text,
        requestId: job.requestId,
      });
      if (!sent.sent) code = sent.code;
    }
    if (code !== undefined && TRANSIENT.has(code)) return 'retry';

    await db
      .updateTable('grants.message_notification')
      .set((eb) =>
        code === undefined
          ? { status: 'sent', sent_at: eb.fn<Date>('now', []) }
          : { status: 'failed', error_code: code },
      )
      .where('id', '=', job.notificationId)
      .execute();
    return code === undefined ? 'sent' : 'failed';
  };
}
