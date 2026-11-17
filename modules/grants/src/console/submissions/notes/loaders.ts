// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the notes screens read and send. A note carries a body and the ids
// of the members it mentions: the author and application come from the
// session and the path (rule 6).

import { call } from '@pixel-scientists/domain/api';

import { addNote, listMentionableMembers, listNotes } from '../../../contracts/index.ts';

export const loadNotes = (submissionId: string) => call(listNotes, { params: { submissionId } });

export const loadMentionable = (submissionId: string) =>
  call(listMentionableMembers, { params: { submissionId } });

/** `idempotencyKey` is the one a lost attempt sent, so trying again adds one note. */
export const postNote = (
  submissionId: string,
  body: string,
  mentions: readonly string[],
  idempotencyKey?: string,
) =>
  call(addNote, {
    params: { submissionId },
    body: { body, mentions: [...mentions] },
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
  });
