// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the triage handlers read from the platform (ADR 0016). The platform
// has already checked the session, the permission and the scope rule. The
// acting member comes from the session alone, never from a request.

import type { AuditChanges } from '@pixel-scientists/db';
import type { Permission } from '@pixel-scientists/domain/platform';

import type { GrantsAuditAction } from '../../contracts/index.ts';
import type { GrantsDependencies } from '../programme/context.ts';
import type { Tx } from '../programme/tables.ts';

export interface TriageDependencies extends Pick<GrantsDependencies, 'notFound' | 'refuse'> {
  /** The active members holding `permission`, read now in the request's tenant. */
  readonly membersWith: (tx: Tx, permission: Permission) => Promise<readonly string[]>;
}

export interface TriageContext {
  readonly audit: {
    record(event: {
      readonly action: GrantsAuditAction;
      readonly entityId: string;
      readonly changes?: AuditChanges;
    }): Promise<void>;
  };
  readonly membership: { readonly id: string };
}

export interface TriageArgs<I> {
  readonly tx: Tx;
  readonly context: TriageContext;
  readonly input: I;
}
