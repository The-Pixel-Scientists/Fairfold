// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Writing a job request (ADR 0009, "Jobs that act for a user"). After the
// route has authorised the request under the session, this inserts the row
// a job will trust and records the route's audit action, in the caller's
// tenant transaction, so both commit or neither does. The requester and
// request id come from the session's actor, the tenant from the
// transaction, and the output's sensitivity from the classification map:
// never from the request. The event holds the request's id, kind,
// permission and sensitivity; never its filters or field list.

import type { Generated, Transaction } from '@pixel-scientists/db';
import type { Sensitivity } from '@pixel-scientists/db/classification';
import type { AuditAction, Permission } from '@pixel-scientists/domain/platform';

import { mostSensitive, type JobRequestKind } from '../../../../packages/db/src/job-request.ts';

import { recordAudit, type AuditActor } from './writer.ts';

/** A filter value: an id, enum, date, integer or flag, or a list of them. */
export type JobRequestFilter = string | number | boolean | null | readonly (string | number)[];

export interface JobRequestInput {
  readonly kind: JobRequestKind;
  /** The permission the route authorised the request under. */
  readonly permission: Permission;
  /** Already parsed by the route's strict schema. */
  readonly filters: Readonly<Record<string, JobRequestFilter>>;
  /** After blind-review and classification filtering. */
  readonly fieldIds: readonly string[];
  /** The pinned form version's classes for any form answer field ids. */
  readonly answerClasses?: Readonly<Record<string, Sensitivity>>;
  readonly requestedBy?: never;
  readonly tenantId?: never;
  readonly outputSensitivity?: never;
}

export type JobRequestActor = Extract<AuditActor, { kind: 'user' }>;

/** The columns app_api may insert. */
type Tables = {
  'app.job_request': {
    id: Generated<string>;
    tenant_id: string;
    kind: JobRequestKind;
    requested_by: string;
    permission: string;
    filters: string;
    field_ids: string[];
    output_sensitivity: Sensitivity;
    request_id: string;
  };
};

/** Write the request and its audit event, and return the request's id. */
export async function createJobRequest(
  trx: Transaction<unknown>,
  actor: JobRequestActor,
  request: JobRequestInput,
  action: AuditAction,
): Promise<string> {
  const { kind, permission, filters, fieldIds, answerClasses } = request;
  const outputSensitivity = mostSensitive(fieldIds, answerClasses);
  const { id } = await trx
    .$extendTables<Tables>()
    .insertInto('app.job_request')
    .values((eb) => ({
      tenant_id: eb.fn<string>('app.current_tenant_id', []),
      kind,
      requested_by: actor.membershipId,
      permission,
      filters: JSON.stringify(filters),
      field_ids: [...fieldIds],
      output_sensitivity: outputSensitivity,
      request_id: actor.requestId,
    }))
    .returning('id')
    .executeTakeFirstOrThrow();
  await recordAudit(trx, actor, {
    action,
    entityId: id,
    changes: {
      'app.job_request.kind': { after: kind },
      'app.job_request.permission': { after: permission },
      'app.job_request.output_sensitivity': { after: outputSensitivity },
    },
  });
  return id;
}
