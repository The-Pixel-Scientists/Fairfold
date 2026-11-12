// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Telling an applicant a message is waiting (ADR 0009, ADR 0033). A funder
// message writes one outbox row and queues one job for it, in the request's
// transaction: a rolled back send leaves neither. The row holds ids and a
// status, never an address or any text, and the job holds the row's id and
// nothing else. The worker sends the email (job.ts). One email goes out for
// each funder message, since a thread keeps no state saying one is waiting.

import type { NoteContext } from '../notes/context.ts';
import { noteDb } from '../notes/tables.ts';
import type { Tx } from '../programme/tables.ts';
import type { MessageDependencies } from './context.ts';

export async function queueNotification(
  tx: Tx,
  deps: Pick<MessageDependencies, 'queueNotification'>,
  context: Pick<NoteContext, 'requestId' | 'membership'>,
  message: { messageId: string; applicationId: string; recipientPersonId: string },
): Promise<void> {
  const db = noteDb(tx);
  // The outbox row points at a template version of the application's programme, and the first one
  // always exists. The text of this email is fixed (email.ts), so the version only anchors the row.
  const template = await db
    .selectFrom('grants.application as a')
    .innerJoin('grants.round as r', 'r.id', 'a.round_id')
    .innerJoin('grants.email_template_version as t', 't.programme_id', 'r.programme_id')
    .select('t.id')
    .where('a.id', '=', message.applicationId)
    .orderBy('t.version')
    .orderBy('t.outcome')
    .limit(1)
    .executeTakeFirstOrThrow();
  const { id } = await db
    .insertInto('grants.message_notification')
    .values((eb) => ({
      tenant_id: eb.fn<string>('app.current_tenant_id', []),
      message_id: message.messageId,
      recipient_person_id: message.recipientPersonId,
      template_version_id: template.id,
    }))
    .returning('id')
    .executeTakeFirstOrThrow();
  await deps.queueNotification(tx, id, {
    requestId: context.requestId,
    membershipId: context.membership.id,
  });
}
