// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Subject access (E3, ADR 0027): a member asks for one party's data, a job
// builds it as a file of the shape below, and the requester downloads it
// through the file download route. The status names no person, and holds a
// failure code, never a message from the job. The same request status serves
// audit log exports.

import { z } from 'zod';

import { classifications } from '../../forms/definition.ts';
import { idSchema } from '../../id.ts';
import { auditEventSchema } from '../audit-log/schemas.ts';
import { moduleSchema } from '../modules.ts';

/** The statuses of a job request (`app.job_request.status`); `expired` once its file is gone. */
export const jobRequestStatuses = ['queued', 'running', 'ready', 'failed', 'expired'] as const;

export type JobRequestStatus = (typeof jobRequestStatuses)[number];

/** A job's failure code from the closed list the worker keeps; never a message. */
export const failureCodeSchema = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/);

/** A request that was accepted, answered with 202 before the job runs. */
export const requestAcceptedSchema = z.strictObject({ requestId: idSchema });

export const requestParamsSchema = z.strictObject({ requestId: idSchema });

const requested = { id: idSchema, requestedAt: z.iso.datetime() };

/** A job request as its requester reads it: a file once ready, a code if it failed. */
export const jobRequestSchema = z.discriminatedUnion('status', [
  z.strictObject({ ...requested, status: z.enum(['queued', 'running', 'expired']) }),
  z.strictObject({
    ...requested,
    status: z.literal('ready'),
    fileId: idSchema,
    expiresAt: z.iso.datetime(),
  }),
  z.strictObject({ ...requested, status: z.literal('failed'), failureCode: failureCodeSchema }),
]);

export type JobRequest = z.infer<typeof jobRequestSchema>;

export const subjectAccessRequestSchema = z.strictObject({ partyId: idSchema });

export type SubjectAccessRequest = z.infer<typeof subjectAccessRequestSchema>;

/** `<schema>.<table>`, such as `party.person`. */
export const tableNameSchema = z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/);

/** A column's field id, `<schema>.<table>.<column>`, or a form answer's stable field id (rule 7). */
export const subjectFieldIdSchema = z
  .string()
  .regex(/^(?:[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*|f_[a-z0-9]{1,32})$/);

/** One value, with its field's sensitivity from the classification map or the pinned form version. */
export const subjectDataCellSchema = z.strictObject({
  // nosemgrep: tps-no-loose-api-schema -- the file a subject access job writes, never a request or response body: a cell holds whatever the subject's column or answer holds, as JSON (ADR 0027)
  value: z.json(),
  sensitivity: z.enum(classifications),
});

/** One row, by field id. */
export const subjectDataRowSchema = z.record(subjectFieldIdSchema, subjectDataCellSchema);

export type SubjectDataRow = z.infer<typeof subjectDataRowSchema>;

/** A module's rows about the subject, by table. */
export const subjectDataSchema = z.record(tableNameSchema, z.array(subjectDataRowSchema));

export type SubjectData = z.infer<typeof subjectDataSchema>;

/**
 * An audit event about the subject, found by its subject party id. The
 * actor is given by kind only: staff and other people are not named.
 */
export const subjectAuditEventSchema = auditEventSchema
  .omit({ actor: true })
  .extend({ actor: z.strictObject({ kind: z.enum(['staff', 'applicant', 'system', 'operator']) }) })
  .strict();

/** The export file: machine-readable JSON, every module's rows and the subject's audit events. */
export const subjectAccessExportSchema = z.strictObject({
  version: z.literal(1),
  tenantId: idSchema,
  subjectPartyId: idSchema,
  createdAt: z.iso.datetime(),
  modules: z.partialRecord(moduleSchema, subjectDataSchema),
  auditEvents: z.array(subjectAuditEventSchema),
});

export type SubjectAccessExport = z.infer<typeof subjectAccessExportSchema>;
