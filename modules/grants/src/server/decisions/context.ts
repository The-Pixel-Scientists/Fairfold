// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the decision handlers read from the platform (ADR 0016, ADR 0020).
// The platform has already checked the session, the permission, and for a
// release the recent sign-in. The acting member comes from the session alone.

import type { AuditChanges } from '@pixel-scientists/db';

import type { DecisionEmailErrorCode, GrantsAuditAction } from '../../contracts/index.ts';
import type { GrantsDependencies } from '../programme/context.ts';
import type { Tx } from '../programme/tables.ts';

/** What the mail sender answers. It never throws, and a failure is only a code. */
export interface MailSender {
  send(email: {
    readonly to: string;
    readonly subject: string;
    readonly text: string;
    readonly requestId?: string;
  }): Promise<
    { readonly sent: true } | { readonly sent: false; readonly code: DecisionEmailErrorCode }
  >;
}

export interface DecisionDependencies extends Pick<GrantsDependencies, 'notFound' | 'refuse'> {
  /**
   * Queues the job that sends one outbox row's email, in the request's transaction (ADR 0009).
   * The platform supplies it; the job commits or rolls back with the release. It answers whether
   * a job was queued: false when one for the same row is already waiting.
   */
  queueEmail(
    tx: Tx,
    decisionEmailId: string,
    by: { readonly requestId: string; readonly membershipId: string },
  ): Promise<boolean>;
  /** The applicant portal's origin, which the emails link to. */
  readonly portalOrigin: string;
}

export interface DecisionAudit {
  record(event: {
    readonly action: GrantsAuditAction;
    readonly entityId: string;
    readonly changes?: AuditChanges;
  }): Promise<void>;
}

export interface DecisionContext {
  readonly requestId: string;
  readonly audit: DecisionAudit;
  readonly membership: { readonly id: string };
}

export interface DecisionArgs<I> {
  readonly tx: Tx;
  readonly context: DecisionContext;
  readonly input: I;
}
