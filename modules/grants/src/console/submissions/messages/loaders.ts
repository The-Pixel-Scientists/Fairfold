// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the messages screen reads and sends. Reading a thread is an audited
// read, so it is only called when the member opens the section. A message
// carries its body alone: the side and author come from the session.

import { call } from '@pixel-scientists/domain/api';

import { getStaffThread, markStaffThreadRead, sendStaffMessage } from '../../../contracts/index.ts';

export const loadThread = (submissionId: string) =>
  call(getStaffThread, { params: { submissionId } });

export const markRead = (submissionId: string) =>
  call(markStaffThreadRead, { params: { submissionId } });

/** `idempotencyKey` is the one a lost attempt sent, so trying again sends one message. */
export const postMessage = (submissionId: string, body: string, idempotencyKey?: string) =>
  call(sendStaffMessage, {
    params: { submissionId },
    body: { body },
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
  });
