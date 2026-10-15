// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The audit log's page cursor: where the last event of a page was, as its
// time to the microsecond and its id, the two columns the log is ordered by.
// It is opaque to the apps. A cursor that does not read back exactly is
// refused, so nothing a caller sends reaches the query unchecked.

import { idSchema } from '@pixel-scientists/domain';

import { ApiError } from '../../problems.ts';

export interface AuditCursor {
  /** UTC with microseconds, `2026-10-07T09:30:00.123456Z`, as the database prints it. */
  readonly occurredAt: string;
  readonly id: string;
}

const CURSOR = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z)\|(.{36})$/;

export const encodeCursor = ({ occurredAt, id }: AuditCursor): string =>
  Buffer.from(`${occurredAt}|${id}`).toString('base64url');

export function decodeCursor(cursor: string): AuditCursor {
  const [, occurredAt, id] = CURSOR.exec(Buffer.from(cursor, 'base64url').toString()) ?? [];
  const date = new Date(occurredAt ?? '');
  const valid =
    occurredAt !== undefined &&
    id !== undefined &&
    idSchema.safeParse(id).success &&
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 19) === occurredAt.slice(0, 19);
  if (!valid) {
    throw new ApiError(400, 'That page link is not valid. Go back to the first page.', {
      reason: 'invalid_cursor',
    });
  }
  return { occurredAt, id };
}
