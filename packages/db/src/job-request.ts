// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Jobs that act for a member (ADR 0009): the payload their queues carry, the
// sensitivity of their output, the requester-only output lookup and the
// bounded delete of expired requests. The API writes a request through
// createJobRequest() in apps/api/src/audit, which audits it.

import { idSchema } from '@pixel-scientists/domain';
import { sql, type Transaction } from 'kysely';
import { z } from 'zod';

import { classification, SENSITIVITIES, type Sensitivity } from '../classification.ts';

/** What a member can ask a job for, as app.job_request.kind's check lists. */
export const JOB_REQUEST_KINDS = [
  'subject_access',
  'erasure',
  'audit_log_export',
  'view_csv_export',
  'board_pack',
] as const;
export type JobRequestKind = (typeof JOB_REQUEST_KINDS)[number];

/**
 * The payload of every queue whose jobs act for a member: the job request's
 * id alone. The send helper adds the tenant and request ids, and refuses
 * any key holding "requestId", so the key is `jobRequest`.
 */
export const jobRequestPayload = z.strictObject({ jobRequest: idSchema });

const COLUMN_FIELD_ID = /^([a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)$/;
const FORM_FIELD_ID = /^f_[a-z0-9]{1,32}$/;
/** The most rows one deleteExpiredJobRequests() call removes. */
const MAX_DELETE = 10_000;

function sensitivityOf(
  fieldId: string,
  answerClasses: Readonly<Record<string, Sensitivity>>,
): Sensitivity {
  if (FORM_FIELD_ID.test(fieldId)) {
    // An answer whose question's class is not given counts as the highest.
    return Object.hasOwn(answerClasses, fieldId)
      ? (answerClasses[fieldId] ?? 'special_category')
      : 'special_category';
  }
  const [, table = '', column = ''] = COLUMN_FIELD_ID.exec(fieldId) ?? [];
  const fields = Object.hasOwn(classification, table) ? classification[table] : undefined;
  const field = fields && Object.hasOwn(fields, column) ? fields[column] : undefined;
  if (!field) throw new Error(`Field ${fieldId} is not in the classification map.`);
  return field.sensitivity;
}

/**
 * The most sensitive of the fields, which a job's output is classified as.
 * A column takes its class from the classification map, and a form answer
 * from `answerClasses`, the pinned form version's classes by field id, or
 * special category if it is not there. Throws for an unknown field id or an
 * empty list, rather than classing the output low.
 */
export function mostSensitive(
  fieldIds: readonly string[],
  answerClasses: Readonly<Record<string, Sensitivity>> = {},
): Sensitivity {
  if (fieldIds.length === 0) throw new Error('A job request names at least one field.');
  const rank = Math.max(
    ...fieldIds.map((id) => SENSITIVITIES.indexOf(sensitivityOf(id, answerClasses))),
  );
  const sensitivity = SENSITIVITIES[rank];
  if (sensitivity === undefined) throw new Error('A field has an unknown sensitivity.');
  return sensitivity;
}

/**
 * The output file of a ready, unexpired request, only for the membership
 * that asked, which comes from the session. Anything else finds nothing,
 * so "not yours" and "not there" look the same (the API answers 404).
 */
export async function findJobRequestOutput<DB>(
  trx: Transaction<DB>,
  request: { readonly jobRequestId: string; readonly membershipId: string },
): Promise<string | undefined> {
  const { jobRequestId, membershipId } = request;
  if (!idSchema.safeParse(jobRequestId).success || !idSchema.safeParse(membershipId).success) {
    return undefined;
  }
  const { rows } = await sql<{ output_file_id: string }>`
    SELECT output_file_id FROM app.job_request
     WHERE id = ${jobRequestId} AND requested_by = ${membershipId}
       AND status = 'ready' AND expires_at > pg_catalog.now()
  `.execute(trx);
  return rows[0]?.output_file_id;
}

/**
 * Delete at most `limit` requests of the transaction's tenant that are past
 * their expiry, as app_worker, and return how many went. Row-level security
 * lets the worker delete no other.
 */
export async function deleteExpiredJobRequests<DB>(
  trx: Transaction<DB>,
  limit: number,
): Promise<number> {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_DELETE) {
    throw new Error(`The limit must be a whole number from 1 to ${String(MAX_DELETE)}.`);
  }
  const result = await sql`
    DELETE FROM app.job_request
     WHERE id IN (SELECT r.id FROM app.job_request r
                   WHERE r.tenant_id = app.current_tenant_id()
                     AND r.expires_at < pg_catalog.now()
                   LIMIT ${limit})
  `.execute(trx);
  return Number(result.numAffectedRows ?? 0n);
}
