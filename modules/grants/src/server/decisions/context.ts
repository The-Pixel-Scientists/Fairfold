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
  readonly sender: MailSender;
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

/** Runs `work` in a transaction of its own, as the acting member. */
export type OwnTransaction = <T>(work: (tx: Tx, audit: DecisionAudit) => Promise<T>) => Promise<T>;

export interface DecisionContext {
  readonly requestId: string;
  readonly audit: DecisionAudit;
  readonly membership: { readonly id: string };
  /** Queues work for after the request's transaction commits (the platform runs it, then encodes the answer). */
  afterCommit(work: (own: OwnTransaction) => Promise<void>): void;
}

export interface DecisionArgs<I> {
  readonly tx: Tx;
  readonly context: DecisionContext;
  readonly input: I;
}
