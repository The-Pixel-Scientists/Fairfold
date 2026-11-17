// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Asking for an export of the audit log, and reading how it went (ADR 0009,
// "Jobs that act for a user"). Only a named member with the audit export
// permission asks, after step-up; the route's strict schema parses the
// filters and the acting member comes from the session (rules 6 and 9). The
// request records who asked, the permission and the filters, writes
// `platform.audit_log.exported` and sends one job holding the request's id,
// all in one transaction. The file is made by the job. Only the member who
// asked reads the request; anyone else gets the same 404 as for no request.

import { defineQueue, sendJob, type JobSender } from '@pixel-scientists/db/jobs';
import { idSchema } from '@pixel-scientists/domain';
import type {
  AuditExportFilters,
  exportAuditEvents,
  readAuditExport,
} from '@pixel-scientists/domain/platform/audit-log';
import { z } from 'zod';

import { createJobRequest, type JobRequestFilter } from '../../audit/job-request.ts';
import { ApiError } from '../../problems.ts';
import type { Handler, Replay } from '../../routes/register.ts';
import { AUDIT_EXPORT_FIELD_IDS } from './rows.ts';

/** Migration 0029's tenant queue; its payload is the request's id and nothing else. */
export const auditLogExportQueue = defineQueue(
  'platform.audit_log_export',
  'tenant',
  z.strictObject({ jobRequest: idSchema }),
);

type Tables = {
  'app.job_request': {
    id: string;
    kind: string;
    requested_by: string;
    filters: Record<string, JobRequestFilter>;
    status: 'queued' | 'running' | 'ready' | 'failed' | 'expired';
    failure_code: string | null;
    output_file_id: string | null;
    requested_at: Date;
    expires_at: Date | null;
  };
};

const KIND = 'audit_log_export';

const notFound = (): Error => new ApiError(404, undefined, { reason: 'not_found' });

/** The filters the request names, without the ones it left out. */
const namedFilters = (filters: AuditExportFilters): Record<string, string> =>
  Object.fromEntries(
    Object.entries<string | undefined>(filters).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );

export const requestAuditExportHandler =
  (jobs: JobSender): Handler<typeof exportAuditEvents> =>
  async ({ tx, context, input }) => {
    const requestId = await createJobRequest(
      tx,
      { kind: 'user', membershipId: context.membership.id, requestId: context.requestId },
      {
        kind: KIND,
        permission: 'platform.audit.export',
        filters: namedFilters(input.body),
        fieldIds: AUDIT_EXPORT_FIELD_IDS,
      },
      'platform.audit_log.exported',
    );
    await sendJob(
      tx,
      auditLogExportQueue,
      { jobRequest: requestId },
      { sender: jobs, requestId: context.requestId, causingUserId: context.membership.id },
      { singletonOn: ['jobRequest'] },
    );
    return { requestId };
  };

export const readAuditExportHandler: Handler<typeof readAuditExport> = async ({
  tx,
  context,
  input,
}) => {
  const { requestId: id } = input.params;
  const request = await tx
    .$extendTables<Tables>()
    .selectFrom('app.job_request')
    .select(['status', 'failure_code', 'output_file_id', 'requested_at', 'expires_at'])
    .where('id', '=', id)
    .where('kind', '=', KIND)
    .where('requested_by', '=', context.membership.id)
    .executeTakeFirst();
  if (request === undefined) throw notFound();

  const requestedAt = request.requested_at.toISOString();
  if (request.status === 'failed') {
    return { id, requestedAt, status: 'failed', failureCode: request.failure_code ?? 'internal' };
  }
  if (request.status === 'ready') {
    // Past its expiry a file is refused even before the expiry job removes it.
    if (request.output_file_id === null || request.expires_at === null) throw notFound();
    if (request.expires_at.getTime() <= Date.now()) return { id, requestedAt, status: 'expired' };
    return {
      id,
      requestedAt,
      status: 'ready',
      fileId: request.output_file_id,
      expiresAt: request.expires_at.toISOString(),
    };
  }
  return { id, requestedAt, status: request.status };
};

/**
 * A retry with the same idempotency key answers the request it made. The
 * first answer holds no `id`, so the request is the member's latest of this
 * kind that names the same filters.
 */
export const replayAuditExportRequest: Replay<typeof exportAuditEvents> = async ({
  tx,
  context,
  input,
}) => {
  const asked = JSON.stringify(Object.entries(namedFilters(input.body)).sort());
  const made = await tx
    .$extendTables<Tables>()
    .selectFrom('app.job_request')
    .select(['id', 'filters'])
    .where('kind', '=', KIND)
    .where('requested_by', '=', context.membership.id)
    .orderBy('requested_at', 'desc')
    .execute();
  const same = made.find(({ filters }) => JSON.stringify(Object.entries(filters).sort()) === asked);
  if (same === undefined) throw notFound();
  return { requestId: same.id };
};
