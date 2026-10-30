// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Reading an application's attachments: the clean files linked to its file
// questions, oldest first (ADR 0047). Staff see only those the projection
// gives staff, so a question's audiences and its visibility decide, as for
// answers.

import { fileTypes } from '@pixel-scientists/domain/files';
import { projectAnswers } from '@pixel-scientists/domain/forms';

import type { AttachmentView } from '../../contracts/index.ts';
import { answersWithFiles } from '../applications/read.ts';
import { applicationsDb } from '../applications/tables.ts';
import { definitionOf } from '../forms/read.ts';
import type { Tx } from '../programme/tables.ts';

/** The application's attachments. Row-level security keeps the read inside the caller's tenant. */
export async function readAttachments(tx: Tx, applicationId: string): Promise<AttachmentView[]> {
  const rows = await applicationsDb(tx)
    .selectFrom('grants.application_file as l')
    .innerJoin('app.file as f', 'f.id', 'l.file_id')
    .select(['f.id', 'f.name', 'f.content_type', 'f.size_bytes', 'f.created_at', 'l.field_id'])
    .where('l.application_id', '=', applicationId)
    .orderBy('l.created_at')
    .orderBy('l.id')
    .execute();
  return rows.flatMap((row) => {
    const type = fileTypes.find((candidate) => candidate === row.content_type);
    return type === undefined
      ? []
      : [
          {
            id: row.id,
            name: row.name,
            type,
            bytes: Number(row.size_bytes),
            uploadedAt: row.created_at.toISOString(),
            fieldId: row.field_id,
          },
        ];
  });
}

/**
 * The files of a submitted or withdrawn application that staff may see, or
 * undefined where there is no such submission, a draft's id included.
 */
export async function readStaffAttachments(
  tx: Tx,
  applicationId: string,
): Promise<AttachmentView[] | undefined> {
  const row = await applicationsDb(tx)
    .selectFrom('grants.application as a')
    .innerJoin('grants.form_version as f', 'f.id', 'a.form_version_id')
    .select(['a.answers', 'f.definition'])
    .where('a.id', '=', applicationId)
    .where('a.status', 'in', ['submitted', 'withdrawn'])
    .executeTakeFirst();
  const definition = definitionOf(row?.definition ?? null);
  if (row === undefined || definition === null) return undefined;

  const answers = await answersWithFiles(tx, applicationId, row.answers);
  const shown = projectAnswers(definition, answers, 'staff');
  return (await readAttachments(tx, applicationId)).filter((attachment) => {
    const ids = shown[attachment.fieldId];
    return Array.isArray(ids) && ids.includes(attachment.id);
  });
}
