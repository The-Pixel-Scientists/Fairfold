// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Attaching a file to a draft's file question (ADR 0047). The checks run in
// the ADR's order: the applicant's own draft in a round taking applications;
// a file question that is shown for the answers; the question's file count
// and the application's total size; then the file service checks the name,
// type and scan. The application row is locked only after the scan, so
// autosave is not held up, and the counts are made again under the lock, so
// two uploads at once cannot pass a limit together.

import { fileRefusalMessages, MAX_FILE_BYTES } from '@pixel-scientists/domain/files';
import { visibleFields, type FileField } from '@pixel-scientists/domain/forms';

import {
  attachmentMessages,
  MAX_ATTACHMENT_BYTES,
  type AttachmentView,
} from '../../contracts/index.ts';
import type { ApplicationDependencies } from '../applications/context.ts';
import { lockOwn, type LockedApplication } from '../applications/lock.ts';
import { answersWithFiles } from '../applications/read.ts';
import { closing } from '../applications/submit.ts';
import { applicationsDb } from '../applications/tables.ts';
import type { Tx } from '../programme/tables.ts';
import type { AttachmentArgs } from './context.ts';
import { readAttachments } from './read.ts';

export const refusals = {
  notDraft: 'This application has been submitted, so its files can no longer change.',
  closed: 'This round has closed, so files can no longer be added.',
  notFileQuestion: 'This is not a question you can add files to.',
} as const;

export function uploadHandler(deps: ApplicationDependencies) {
  const refuseField = (fieldId: string, message: string): Error =>
    deps.refuse(400, message, [{ field: fieldId, message }]);

  /** The file question, which must be shown for the application's answers as they are now. */
  async function fileQuestion(
    tx: Tx,
    application: LockedApplication,
    fieldId: string,
  ): Promise<FileField> {
    const answers = await answersWithFiles(tx, application.id, application.answers);
    const field = visibleFields(application.definition, answers).find(
      (candidate): candidate is FileField => candidate.type === 'file' && candidate.id === fieldId,
    );
    if (field === undefined) throw refuseField(fieldId, refusals.notFileQuestion);
    return field;
  }

  /** Refuses a file that would take the question past its count, or the application past its total. */
  async function checkRoom(
    tx: Tx,
    application: LockedApplication,
    field: FileField,
    bytes: number,
  ): Promise<void> {
    if (application.status !== 'draft') throw deps.refuse(409, refusals.notDraft);
    const linked = await readAttachments(tx, application.id);
    if (linked.filter((file) => file.fieldId === field.id).length >= field.maxFiles) {
      throw refuseField(field.id, fileRefusalMessages.too_many);
    }
    const total = linked.reduce((sum, file) => sum + file.bytes, 0);
    if (total + bytes > MAX_ATTACHMENT_BYTES) {
      throw refuseField(field.id, attachmentMessages.applicationFull);
    }
  }

  return async function uploadAttachment({
    tx,
    context,
    input,
  }: AttachmentArgs<{
    params: { applicationId: string; fieldId: string };
    body: { name: string; bytes: Uint8Array };
  }>): Promise<AttachmentView> {
    const { applicationId, fieldId } = input.params;
    const { name, bytes } = input.body;
    const { userId } = context.session;

    const draft = await lockOwn(tx, deps, userId, applicationId, false);
    if (draft.status !== 'draft') throw deps.refuse(409, refusals.notDraft);
    const round = await closing(tx, draft.roundId);
    if (!round.taking) throw deps.notFound();
    if (round.closed && round.late_policy === 'refuse') throw deps.refuse(409, refusals.closed);
    const field = await fileQuestion(tx, draft, fieldId);
    await checkRoom(tx, draft, field, bytes.length);

    const result = await context.files.store({
      name,
      bytes,
      allowedTypes: field.allowedTypes,
      maxBytes: Math.min(field.maxBytes, MAX_FILE_BYTES),
    });
    if ('refusal' in result) {
      // Answered after the commit, so the refused file's row and audit event are kept.
      const message = fileRefusalMessages[result.refusal];
      context.afterCommit(() => Promise.reject(refuseField(fieldId, message)));
      return undefined as never;
    }

    const locked = await lockOwn(tx, deps, userId, applicationId);
    await checkRoom(tx, locked, await fileQuestion(tx, locked, fieldId), result.file.bytes);
    await applicationsDb(tx)
      .insertInto('grants.application_file')
      .values((eb) => ({
        tenant_id: eb.fn<string>('app.current_tenant_id', []),
        application_id: applicationId,
        file_id: result.file.id,
        field_id: fieldId,
        created_by: context.membership.id,
      }))
      .execute();
    return { ...result.file, fieldId };
  };
}
