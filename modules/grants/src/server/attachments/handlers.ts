// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The attachment routes (ADR 0047, ADR 0004), matched with their contracts in
// apps/api/src/modules.ts. The applicant's routes name their own application
// in every query, and the staff routes read submitted and withdrawn
// applications only, so any other id, another tenant's included, reads as a
// missing one. Removing a link leaves the file for the retention sweep. The
// applicant's own reads and removals are not audited; each staff download is,
// by the file service.

import type { AttachmentList } from '../../contracts/index.ts';
import type { ApplicationDependencies } from '../applications/context.ts';
import { lockOwn } from '../applications/lock.ts';
import { applicationsDb } from '../applications/tables.ts';
import type { AttachmentArgs } from './context.ts';
import { readAttachments, readStaffAttachments } from './read.ts';
import { refusals, uploadHandler } from './upload.ts';

type OnApplication<P = object> = AttachmentArgs<{ params: { applicationId: string } & P }>;
type OnSubmission<P = object> = AttachmentArgs<{ params: { submissionId: string } & P }>;

export function attachmentHandlers(deps: ApplicationDependencies) {
  async function listAttachments({ tx, context, input }: OnApplication): Promise<AttachmentList> {
    const { applicationId } = input.params;
    await lockOwn(tx, deps, context.session.userId, applicationId, false);
    return { attachments: await readAttachments(tx, applicationId) };
  }

  async function removeAttachment({
    tx,
    context,
    input,
  }: OnApplication<{ fileId: string }>): Promise<undefined> {
    const { applicationId, fileId } = input.params;
    const application = await lockOwn(tx, deps, context.session.userId, applicationId);
    if (application.status !== 'draft') throw deps.refuse(409, refusals.notDraft);
    const removed = await applicationsDb(tx)
      .deleteFrom('grants.application_file')
      .where('application_id', '=', applicationId)
      .where('file_id', '=', fileId)
      .returning('id')
      .executeTakeFirst();
    if (removed === undefined) throw deps.notFound();
    return undefined;
  }

  async function downloadAttachment({ tx, context, input }: OnApplication<{ fileId: string }>) {
    const { applicationId, fileId } = input.params;
    await lockOwn(tx, deps, context.session.userId, applicationId, false);
    const attachments = await readAttachments(tx, applicationId);
    if (!attachments.some((attachment) => attachment.id === fileId)) throw deps.notFound();
    return context.files.send(fileId, { audit: false });
  }

  async function listSubmissionAttachments({ tx, input }: OnSubmission): Promise<AttachmentList> {
    const attachments = await readStaffAttachments(tx, input.params.submissionId);
    if (attachments === undefined) throw deps.notFound();
    return { attachments };
  }

  async function downloadSubmissionAttachment({
    tx,
    context,
    input,
  }: OnSubmission<{ fileId: string }>) {
    const { submissionId, fileId } = input.params;
    const attachments = await readStaffAttachments(tx, submissionId);
    if (!attachments?.some((attachment) => attachment.id === fileId)) throw deps.notFound();
    return context.files.send(fileId, { audit: true });
  }

  return {
    uploadAttachment: uploadHandler(deps),
    listAttachments,
    removeAttachment,
    downloadAttachment,
    listSubmissionAttachments,
    downloadSubmissionAttachment,
  };
}
