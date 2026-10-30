// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the submission pages read and send. Defined once, here, so useLoad
// reads again only when a page asks it to.

import { apiBasePath, call, ProblemError } from '@pixel-scientists/domain/api';

import {
  downloadSubmissionAttachment,
  getSubmission,
  listProgrammes,
  listStages,
  listSubmissionAttachments,
  listSubmissions,
  moveSubmissionsToStage,
} from '../../contracts/index.ts';
import type { ProgrammeList, SubmissionQuery } from '../../contracts/index.ts';
import { callQuery, withCursor } from './query.ts';

export const loadSubmissionPage = (query: SubmissionQuery) =>
  call(listSubmissions, { query: callQuery(query) });

/**
 * The programmes and rounds the filters offer. Someone who may read
 * submissions but not set up programmes gets none, and filters by what they
 * can see in the list instead.
 */
export async function loadProgrammes(): Promise<ProgrammeList['programmes']> {
  try {
    return (await call(listProgrammes, {})).programmes;
  } catch (error) {
    if (error instanceof ProblemError && error.status === 403) return [];
    throw error;
  }
}

export const loadStages = (roundId: string) => call(listStages, { params: { roundId } });

/** Where one of a submission's files downloads from. Made from ids: a file's name never goes in an address. */
export function downloadHref(submissionId: string, fileId: string): string {
  return `${apiBasePath}${downloadSubmissionAttachment.path
    .replace(':submissionId', encodeURIComponent(submissionId))
    .replace(':fileId', encodeURIComponent(fileId))}`;
}

/** A submission with its files, and its round's stages when they can be read. */
export async function loadSubmission(submissionId: string) {
  const params = { submissionId };
  const [submission, { attachments }] = await Promise.all([
    call(getSubmission, { params }),
    call(listSubmissionAttachments, { params }),
  ]);
  const stages = await loadStages(submission.round.id).then(
    (list) => list.stages,
    () => null,
  );
  return { submission, files: attachments, stages };
}

export const moveToStage = (stageId: string, submissionIds: readonly string[]) =>
  call(moveSubmissionsToStage, {
    params: { stageId },
    body: { submissionIds: [...submissionIds] },
  });

interface Neighbour {
  id: string;
  /** The filters and page of the list it is on. */
  query: SubmissionQuery;
}

/** The submissions either side of one in the list it was opened from. */
export interface Neighbours {
  previous: Neighbour | null;
  next: Neighbour | null;
}

/**
 * The ids either side of `id` in the list `query` describes, each with the
 * query of the page it is on. The list can only be read forwards, so the
 * first submission on a page has no previous, and the last one's next is
 * the first of the page after.
 */
export async function loadNeighbours(query: SubmissionQuery, id: string): Promise<Neighbours> {
  const page = await loadSubmissionPage(query);
  const index = page.submissions.findIndex((submission) => submission.id === id);
  if (index === -1) return { previous: null, next: null };
  const before = page.submissions[index - 1];
  let next = page.submissions[index + 1];
  let nextQuery = query;
  if (next === undefined && page.nextCursor !== null) {
    nextQuery = withCursor(query, page.nextCursor);
    next = (await loadSubmissionPage(nextQuery)).submissions[0];
  }
  return {
    previous: before === undefined ? null : { id: before.id, query },
    next: next === undefined ? null : { id: next.id, query: nextQuery },
  };
}
