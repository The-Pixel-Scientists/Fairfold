// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the assessment handlers read from the platform (ADR 0016). The
// platform has already checked the session, the permission and the scope
// rule. The acting member comes from the session alone, never from a request.

import type { AuditChanges } from '@pixel-scientists/db';
import type { Permission } from '@pixel-scientists/domain/platform';

import type { GrantsAuditAction } from '../../contracts/index.ts';
import type { GrantsDependencies } from '../programme/context.ts';
import type { Tx } from '../programme/tables.ts';

export interface AssessmentDependencies extends Pick<GrantsDependencies, 'notFound' | 'refuse'> {
  /** The ids of the tenant's active members whose roles give `permission`. */
  readonly membersWith: (tx: Tx, permission: Permission) => Promise<readonly string[]>;
}

/** What a handler reads from the request context. */
export interface AssessmentContext {
  readonly audit: {
    record(event: {
      readonly action: GrantsAuditAction;
      readonly entityId: string;
      readonly changes?: AuditChanges;
    }): Promise<void>;
    /** Records a sensitive read. */
    read(event: { readonly action: GrantsAuditAction; readonly entityId: string }): Promise<void>;
  };
  readonly membership: { readonly id: string };
}

export interface AssessmentArgs<I> {
  readonly tx: Tx;
  readonly context: AssessmentContext;
  readonly input: I;
}
