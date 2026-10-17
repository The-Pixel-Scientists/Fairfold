// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Sending a round's decision emails from the outbox (ADR 0020), after the
// transaction that released them has committed. Each email is sent in a
// short transaction of its own: it locks its row, so a second request never
// sends the same email at the same time; checks the decision is still
// released and its release event exists; fills the template version fixed at
// release; sends; and marks the row sent or failed with a code, never a
// message. Delivery is at least once: a crash between the mail server
// accepting an email and the mark sends it again on resend.

import {
  renderTemplate,
  type DecisionEmailErrorCode,
  type EmailDelivery,
} from '../../contracts/index.ts';
import type { DecisionDependencies, DecisionAudit, OwnTransaction } from './context.ts';
import { mergeValuesFor } from './email.ts';
import { decisionsDb } from './tables.ts';
import type { Tx } from '../programme/tables.ts';

/** The most emails one request sends. */
export const MAX_SENT_PER_REQUEST = 500;

/** A release sends the emails waiting to send; sending again also tries those not sent. */
export type SendMode = 'release' | 'resend';

type Attempt = 'sent' | 'failed' | 'left';

export function emailSender(deps: DecisionDependencies) {
  async function sendOne(
    tx: Tx,
    audit: DecisionAudit,
    mode: SendMode,
    request: { id: string; roundId: string; memberId: string; requestId: string },
  ): Promise<Attempt> {
    const db = decisionsDb(tx);
    const row = await db
      .selectFrom('grants.decision_email as e')
      .innerJoin('grants.decision as d', 'd.id', 'e.decision_id')
      .innerJoin('grants.application as a', 'a.id', 'd.application_id')
      .innerJoin('grants.round as r', 'r.id', 'a.round_id')
      .innerJoin('grants.programme as p', 'p.id', 'r.programme_id')
      .innerJoin('grants.email_template_version as t', 't.id', 'e.template_version_id')
      .select([
        'e.status',
        'e.error_code',
        'e.recipient_person_id',
        'd.id as decision_id',
        'd.outcome',
        'd.amount_minor',
        'a.organisation_id',
        'p.title as programme_title',
        'r.title as round_title',
        't.subject',
        't.body',
      ])
      .where('e.id', '=', request.id)
      .where('a.round_id', '=', request.roundId)
      .where('e.status', 'in', mode === 'release' ? ['pending'] : ['pending', 'failed'])
      .where('d.released_at', 'is not', null)
      .forUpdate('e')
      .skipLocked()
      .executeTakeFirst();
    if (row === undefined) return 'left';
    const released = await db
      .selectFrom('app.audit_event')
      .select('id')
      .where('action', '=', 'grants.decision.released')
      .where('entity_id', '=', row.decision_id)
      .executeTakeFirst();
    if (released === undefined) return 'left';

    const { values, address } = await mergeValuesFor(tx, deps.portalOrigin, row);
    let code: DecisionEmailErrorCode | undefined;
    if (address === null) {
      code = 'no_address';
    } else {
      let email;
      try {
        email = renderTemplate(row, values);
      } catch {
        code = 'invalid_message';
      }
      if (email !== undefined) {
        const sent = await deps.sender.send({
          to: address,
          subject: email.subject,
          text: email.body,
          requestId: request.requestId,
        });
        if (!sent.sent) code = sent.code;
      }
    }

    const status = code === undefined ? 'sent' : 'failed';
    await db
      .updateTable('grants.decision_email')
      .set({ status, error_code: code ?? null, updated_by: request.memberId })
      .where('id', '=', request.id)
      .execute();
    await audit.record({
      action:
        mode === 'resend'
          ? 'grants.decision_email.resent'
          : status === 'sent'
            ? 'grants.decision_email.sent'
            : 'grants.decision_email.failed',
      entityId: request.id,
      changes: {
        'grants.decision_email.status': { before: row.status, after: status },
        'grants.decision_email.error_code': { before: row.error_code, after: code ?? null },
      },
    });
    return status;
  }

  /** Sends up to 500 of the round's emails, oldest attempt first; the rest are counted as pending. */
  async function deliver(
    own: OwnTransaction,
    mode: SendMode,
    request: { roundId: string; memberId: string; requestId: string },
  ): Promise<EmailDelivery> {
    const waiting = await own((tx) =>
      decisionsDb(tx)
        .selectFrom('grants.decision_email as e')
        .innerJoin('grants.decision as d', 'd.id', 'e.decision_id')
        .innerJoin('grants.application as a', 'a.id', 'd.application_id')
        .select('e.id')
        .where('a.round_id', '=', request.roundId)
        .where('e.status', 'in', mode === 'release' ? ['pending'] : ['pending', 'failed'])
        .orderBy('e.last_attempt_at', (order) => order.asc().nullsFirst())
        .orderBy('e.created_at')
        .orderBy('e.id')
        .execute(),
    );
    const delivery = { sent: 0, failed: 0, pending: waiting.length };
    for (const { id } of waiting.slice(0, MAX_SENT_PER_REQUEST)) {
      const attempt = await own((tx, audit) => sendOne(tx, audit, mode, { ...request, id }));
      if (attempt !== 'left') {
        delivery[attempt]++;
        delivery.pending--;
      }
    }
    return delivery;
  }

  return { deliver };
}
