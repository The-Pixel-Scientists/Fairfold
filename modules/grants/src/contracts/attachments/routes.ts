// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Files attached to an application's file questions (ADR 0047, ADR 0004).
// An applicant attaches, lists, removes and downloads the files on their
// own applications, under `grants.applications.apply` and `own_application`.
// Staff with `grants.applications.read` list and download a submission's
// files, anywhere in the tenant. Anything else, including another tenant's
// file and a file on another application, answers 404, as if it did not
// exist.
//
// The MVP1 rules:
// - files are attached and removed only while the application is a draft;
//   a submitted or withdrawn application keeps its files;
// - only clean files are linked, so only clean files are listed or sent;
// - an upload is refused past its question's file count and size, or past
//   MAX_ATTACHMENT_BYTES for the application;
// - removing a file deletes its link only;
// - drafts never appear in a console route, and staff see only files on
//   questions whose audiences include staff;
// - no reviewer route: every MVP1 reviewer has the blind projection, and a
//   document can name the applicant whatever it is called;
// - paths carry ids only, and a file's name travels only in the `File-Name`
//   request header and the download's `Content-Disposition`;
// - each staff download is audited as `platform.file.downloaded`; the
//   applicant's own reads and removals are not.

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute } from '@pixel-scientists/domain/api';
import { fileTypes, MAX_FILE_BYTES } from '@pixel-scientists/domain/files';
import { fieldIdSchema } from '@pixel-scientists/domain/forms';
import { z } from 'zod';

import { attachmentListSchema, attachmentViewSchema } from './answers.ts';

const mine = {
  audience: 'portal',
  module: 'grants',
  permission: 'grants.applications.apply',
  scope: 'own_application',
} as const;

const staff = {
  audience: 'console',
  module: 'grants',
  permission: 'grants.applications.read',
  scope: 'tenant',
} as const;

const application = z.strictObject({ applicationId: idSchema });

const file = z.strictObject({ applicationId: idSchema, fileId: idSchema });

const submission = z.strictObject({ submissionId: idSchema });

const submissionFile = z.strictObject({ submissionId: idSchema, fileId: idSchema });

/** The file's bytes, in the type found when it was uploaded. */
const fileBytes = { 200: { raw: fileTypes } } as const;

export const uploadAttachment = defineRoute({
  ...mine,
  method: 'POST',
  path: '/portal/applications/:applicationId/fields/:fieldId/files',
  summary: "Attach a file to one of a draft's file questions, scanned before it is stored",
  params: z.strictObject({ applicationId: idSchema, fieldId: fieldIdSchema }),
  body: { raw: ['application/octet-stream'], maxBytes: MAX_FILE_BYTES },
  responses: { 201: attachmentViewSchema },
});

export const listAttachments = defineRoute({
  ...mine,
  method: 'GET',
  path: '/portal/applications/:applicationId/files',
  summary: "List the files attached to one of the caller's applications",
  params: application,
  responses: { 200: attachmentListSchema },
});

export const removeAttachment = defineRoute({
  ...mine,
  method: 'DELETE',
  path: '/portal/applications/:applicationId/files/:fileId',
  summary: 'Remove a file from a draft',
  params: file,
  responses: { 204: null },
});

export const downloadAttachment = defineRoute({
  ...mine,
  method: 'GET',
  path: '/portal/applications/:applicationId/files/:fileId',
  summary: "Download a file attached to one of the caller's applications",
  params: file,
  responses: fileBytes,
});

export const listSubmissionAttachments = defineRoute({
  ...staff,
  method: 'GET',
  path: '/console/submissions/:submissionId/files',
  summary: "List a submission's files on questions staff see",
  params: submission,
  responses: { 200: attachmentListSchema },
});

export const downloadSubmissionAttachment = defineRoute({
  ...staff,
  method: 'GET',
  path: '/console/submissions/:submissionId/files/:fileId',
  summary: "Download one of a submission's files, recording the read",
  params: submissionFile,
  responses: fileBytes,
});

export const attachmentRoutes = {
  uploadAttachment,
  listAttachments,
  removeAttachment,
  downloadAttachment,
  listSubmissionAttachments,
  downloadSubmissionAttachment,
} as const;
