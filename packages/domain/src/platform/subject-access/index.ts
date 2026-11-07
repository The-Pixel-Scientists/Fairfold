// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Subject access and erasure contracts: the `/platform/subject-access` subpath
// of the domain package.

import '../../jitless/index.ts';

export type {
  ErasureContribution,
  ErasureSubject,
  SubjectDataContribution,
} from './contribution.ts';
export {
  erasureCountsSchema,
  erasureReasons,
  erasureRequestSchema,
  erasureStatuses,
  erasureStatusSchema,
  type ErasureCounts,
  type ErasureReason,
  type ErasureRequest,
  type ErasureStatus,
} from './erasure.ts';
export {
  readErasureRequest,
  readSubjectAccessRequest,
  requestErasure,
  requestSubjectAccess,
  subjectAccessRoutes,
} from './routes.ts';
export {
  failureCodeSchema,
  jobRequestSchema,
  jobRequestStatuses,
  requestAcceptedSchema,
  requestParamsSchema,
  subjectAccessExportSchema,
  subjectAccessRequestSchema,
  subjectAuditEventSchema,
  subjectDataCellSchema,
  subjectDataRowSchema,
  subjectDataSchema,
  subjectFieldIdSchema,
  tableNameSchema,
  type JobRequest,
  type JobRequestStatus,
  type SubjectAccessExport,
  type SubjectAccessRequest,
  type SubjectData,
  type SubjectDataRow,
} from './schemas.ts';
