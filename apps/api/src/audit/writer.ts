// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The audit writer (architecture rule 4). Handlers record state changes,
// decisions, permission changes and sensitive reads through it, in the
// request's own transaction, so an event is written exactly when its change
// commits. It accepts only action codes from the modules' closed lists
// (defineAuditActions() in packages/domain), refuses an action whose
// module rule gives it a subject (ADR 0027) when the event has none, and
// insertAuditEvent() keeps a value only for a public or internal field (D12).

import { insertAuditEvent, type AuditChanges, type Transaction } from '@pixel-scientists/db';
import { idSchema } from '@pixel-scientists/domain';
import {
  auditEntityType,
  isAuditAction,
  type AuditAction,
} from '@pixel-scientists/domain/platform';
import { grantsSubjectRules } from '@pixel-scientists/grants/server';
import { partySubjectRules } from '@pixel-scientists/party/server';

/** Who acted, from the request context: never from a request body or URL. */
export type AuditActor =
  | { readonly kind: 'user'; readonly membershipId: string; readonly requestId: string }
  | { readonly kind: 'system' | 'operator'; readonly requestId: string };

export interface AuditEvent {
  readonly action: AuditAction;
  readonly entityId: string;
  /** Keyed by field id, such as `app.membership.roles`. */
  readonly changes?: AuditChanges;
  /**
   * The party the event is about (ADR 0027), from the record the handler
   * loaded: never from a request body or URL.
   */
  readonly subjectPartyId?: string;
}

/** Actions whose module rule says the event is about a party. */
const subjectBearing: ReadonlySet<string> = new Set(
  Object.entries({ ...partySubjectRules, ...grantsSubjectRules })
    .filter(([, rule]) => !('none' in rule))
    .map(([action]) => action),
);

/** Record a change in the transaction's tenant. */
export async function recordAudit<DB>(
  trx: Transaction<DB>,
  actor: AuditActor,
  event: AuditEvent,
): Promise<void> {
  if (!isAuditAction(event.action)) {
    throw new Error("Audit action is not in any module's list.");
  }
  if (event.subjectPartyId !== undefined && !idSchema.safeParse(event.subjectPartyId).success) {
    throw new Error('Audit subject party id is not a UUID.');
  }
  if (event.subjectPartyId === undefined && subjectBearing.has(event.action)) {
    throw new Error('The audit event has no subject.');
  }
  await insertAuditEvent(trx, {
    requestId: actor.requestId,
    actorKind: actor.kind,
    actorId: actor.kind === 'user' ? actor.membershipId : null,
    action: event.action,
    entityType: auditEntityType(event.action),
    entityId: event.entityId,
    changes: event.changes ?? {},
    subjectPartyId: event.subjectPartyId ?? null,
  });
}

/** Record a sensitive read, such as `grants.application.viewed`. */
export function recordRead<DB>(
  trx: Transaction<DB>,
  actor: AuditActor,
  entity: Pick<AuditEvent, 'action' | 'entityId' | 'subjectPartyId'>,
): Promise<void> {
  const { action, entityId, subjectPartyId } = entity;
  return recordAudit(trx, actor, { action, entityId, subjectPartyId });
}
