// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the message handlers read from the platform (ADR 0016, ADR 0033). A
// staff message queues the job that tells the applicant, in the request's
// transaction, so the job commits or rolls back with the message.

import type { Tx } from '../programme/tables.ts';
import type { NoteDependencies } from '../notes/context.ts';

export interface MessageDependencies extends NoteDependencies {
  /**
   * Queues the job that sends one notification row's email (ADR 0009). The job holds the row's id
   * and nothing else. It answers whether a job was queued: false when one is already waiting.
   */
  queueNotification(
    tx: Tx,
    notificationId: string,
    by: { readonly requestId: string; readonly membershipId: string },
  ): Promise<boolean>;
}
