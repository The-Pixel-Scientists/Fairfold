// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The audit writer (architecture rule 4). Handlers record state changes,
// decisions, permission changes and sensitive reads through it, in the
// request's own transaction, so an event is written exactly when its change
// commits. It accepts only action codes from the modules' closed lists
// (defineAuditActions() in packages/domain), and insertAuditEvent() keeps a
// value only for a public or internal field (D12).

import { insertAuditEvent, type AuditChanges, type Transaction } from '@pixel-scientists/db';
import {
  auditEntityType,
  isAuditAction,
  type AuditAction,
} from '@pixel-scientists/domain/platform';

/** Who acted, from the request context: never from a request body or URL. */
export type AuditActor =
  | { readonly kind: 'user'; readonly membershipId: string; readonly requestId: string }
  | { readonly kind: 'system' | 'operator'; readonly requestId: string };

export interface AuditEvent {
  readonly action: AuditAction;
  readonly entityId: string;
  /** Keyed by field id, such as `app.membership.roles`. */
  readonly changes?: AuditChanges;
}

/** Record a change in the transaction's tenant. */
export async function recordAudit<DB>(
  trx: Transaction<DB>,
  actor: AuditActor,
  event: AuditEvent,
): Promise<void> {
  if (!isAuditAction(event.action)) {
    throw new Error(`Audit action ${event.action} is not in any module's list.`);
  }
  await insertAuditEvent(trx, {
    requestId: actor.requestId,
    actorKind: actor.kind,
    actorId: actor.kind === 'user' ? actor.membershipId : null,
    action: event.action,
    entityType: auditEntityType(event.action),
    entityId: event.entityId,
    changes: event.changes ?? {},
  });
}

/** Record a sensitive read, such as `grants.application.viewed`. */
export function recordRead<DB>(
  trx: Transaction<DB>,
  actor: AuditActor,
  entity: { readonly action: AuditAction; readonly entityId: string },
): Promise<void> {
  return recordAudit(trx, actor, { action: entity.action, entityId: entity.entityId });
}
