// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Sending one decision email for the worker's release email job (ADR 0009,
// ADR 0020). The job holds an outbox row's id, and everything else is read
// here, in the job's own tenant transaction. This locks the row; leaves a
// sent email alone; checks in the database that the decision is still
// released and its release event exists; fills the template version fixed at
// release with the allowlisted values; sends; and marks the row sent or
// failed with a code, never a message. A connection that fails or times out
// is left for the job to try again, and the row stays waiting. Delivery is
// at least once: a crash between the mail server accepting an email and the
// commit sends it again on the retry. Nothing here records, changes or
// releases a decision (architecture rule 9).

import type { AuditChanges } from '@pixel-scientists/db';

import {
  renderTemplate,
  type DecisionEmailErrorCode,
  type GrantsAuditAction,
} from '../../contracts/index.ts';
import type { Tx } from '../programme/tables.ts';
import type { MailSender } from './context.ts';
import { mergeValuesFor } from './email.ts';
import { decisionsDb } from './tables.ts';

/** The failures worth another try: the mail server was not reached, or did not answer in time. */
const TRANSIENT: ReadonlySet<DecisionEmailErrorCode> = new Set(['connection_failed', 'timeout']);

export interface ReleaseEmailDependencies {
  readonly sender: MailSender;
  /** The applicant portal's origin, which the emails link to. */
  readonly portalOrigin: string;
}

export interface ReleaseEmailJob {
  readonly decisionEmailId: string;
  readonly requestId: string;
  /**
   * Records an event in the job's transaction as the job: the system, the job id and the member
   * whose request caused it. The platform binds it, so the actor is never this code's choice.
   */
  readonly audit: (event: {
    readonly action: GrantsAuditAction;
    readonly entityId: string;
    readonly subjectPartyId: string;
    readonly changes: AuditChanges;
  }) => Promise<void>;
}

/**
 * `done`: the email is sent, failed for good, or left alone (grants is off, or it was already
 * sent). `retry`: the mail server could not be reached, so the job should be tried again.
 * `missing`: no such email in this tenant.
 */
export type ReleaseEmailOutcome = 'done' | 'retry' | 'missing';

export function sendReleaseEmail(deps: ReleaseEmailDependencies) {
  return async (tx: Tx, job: ReleaseEmailJob): Promise<ReleaseEmailOutcome> => {
    const db = decisionsDb(tx);
    // A module that is off keeps its data and sends nothing; the row stays waiting (ADR 0024).
    const grants = await db
      .selectFrom('app.tenant_module')
      .select('enabled')
      .where('module', '=', 'grants')
      .executeTakeFirst();
    if (grants?.enabled !== true) return 'done';

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
        'd.released_at',
        'a.organisation_id',
        'p.title as programme_title',
        'r.title as round_title',
        't.subject',
        't.body',
      ])
      .where('e.id', '=', job.decisionEmailId)
      .forUpdate('e')
      .executeTakeFirst();
    if (row === undefined) return 'missing';
    if (row.status === 'sent') return 'done';

    let code: DecisionEmailErrorCode | undefined;
    const releaseEvent =
      row.released_at === null
        ? undefined
        : await db
            .selectFrom('app.audit_event')
            .select('id')
            .where('action', '=', 'grants.decision.released')
            .where('entity_id', '=', row.decision_id)
            .executeTakeFirst();
    if (releaseEvent === undefined) {
      code = 'failed';
    } else {
      const { values, address } = await mergeValuesFor(tx, deps.portalOrigin, row);
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
            requestId: job.requestId,
          });
          if (!sent.sent) code = sent.code;
        }
      }
    }
    if (code !== undefined && TRANSIENT.has(code)) return 'retry';

    const status = code === undefined ? 'sent' : 'failed';
    await db
      .updateTable('grants.decision_email')
      .set({ status, error_code: code ?? null })
      .where('id', '=', job.decisionEmailId)
      .execute();
    await job.audit({
      action: status === 'sent' ? 'grants.decision_email.sent' : 'grants.decision_email.failed',
      entityId: job.decisionEmailId,
      subjectPartyId: row.recipient_person_id,
      changes: {
        'grants.decision_email.status': { before: row.status, after: status },
        'grants.decision_email.error_code': { before: row.error_code, after: code ?? null },
      },
    });
    return 'done';
  };
}
