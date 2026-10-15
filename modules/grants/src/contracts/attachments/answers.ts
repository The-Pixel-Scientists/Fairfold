// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the attachment routes answer, and the limit on an application's
// files (ADR 0047). The applicant and staff see the same view: a file says
// nothing more to staff.

import { fileViewSchema, MAX_FILE_BYTES } from '@pixel-scientists/domain/files';
import { fieldIdSchema } from '@pixel-scientists/domain/forms';
import { z } from 'zod';

/** 100 MiB of attachments per application, counting every linked file. */
export const MAX_ATTACHMENT_BYTES = 10 * MAX_FILE_BYTES;

/** The refusal for an upload that would take an application past MAX_ATTACHMENT_BYTES. */
export const attachmentMessages = {
  applicationFull:
    'The files on this application would come to more than 100 MB. Remove a file or make this one smaller, then try again.',
} as const;

/**
 * A clean file linked to one of an application's file questions. Strict, as
 * the file view is: no storage key, hash, uploader, tenant or scan detail.
 */
export const attachmentViewSchema = fileViewSchema.extend({ fieldId: fieldIdSchema });

export type AttachmentView = z.infer<typeof attachmentViewSchema>;

/** An application's attachments, oldest first, each naming its question. */
export const attachmentListSchema = z.strictObject({
  attachments: z.array(attachmentViewSchema),
});

export type AttachmentList = z.infer<typeof attachmentListSchema>;
