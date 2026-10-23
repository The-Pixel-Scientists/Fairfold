// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the assessment pages read and send. Defined once, here, so useLoad
// reads again only when a page asks it to.

import { call, ProblemError } from '@pixel-scientists/domain/api';

import {
  addReviewers,
  assignReviewers,
  assignReviewersAutomatically,
  declareConflict,
  getProgramme,
  getReview,
  getReviewerPool,
  getRound,
  getScoreSpread,
  getSubmissionScores,
  listAssignments,
  listReviewerCandidates,
  listReviews,
  removeAssignment,
  removeReviewer,
  saveReviewScores,
  submitReview,
} from '../../contracts/index.ts';
import type { Programme, Round, ScoresInput } from '../../contracts/index.ts';

export const loadPool = (roundId: string) => call(getReviewerPool, { params: { roundId } });

/** A round's pool and the members who could be added to it. */
export async function loadPoolPage(roundId: string) {
  const params = { roundId };
  const [pool, candidates] = await Promise.all([
    call(getReviewerPool, { params }),
    call(listReviewerCandidates, { params }),
  ]);
  return { pool: pool.reviewers, candidates: candidates.members };
}

export type PoolPage = Awaited<ReturnType<typeof loadPoolPage>>;

export const addToPool = (roundId: string, membershipIds: readonly string[]) =>
  call(addReviewers, { params: { roundId }, body: { membershipIds: [...membershipIds] } });

export const removeFromPool = (roundId: string, membershipId: string) =>
  call(removeReviewer, { params: { roundId, membershipId } });

export const loadAssignments = (submissionId: string) =>
  call(listAssignments, { params: { submissionId } });

export const assign = (
  stageId: string,
  submissionIds: readonly string[],
  membershipIds: readonly string[],
) =>
  call(assignReviewers, {
    params: { stageId },
    body: { submissionIds: [...submissionIds], membershipIds: [...membershipIds] },
  });

export const assignAutomatically = (
  stageId: string,
  submissionIds: readonly string[],
  reviewersPerSubmission: number,
) =>
  call(assignReviewersAutomatically, {
    params: { stageId },
    body: { submissionIds: [...submissionIds], reviewersPerSubmission },
  });

export const unassign = (assignmentId: string) =>
  call(removeAssignment, { params: { assignmentId } });

/** The round and its programme, for a page's heading, or null when they cannot be read: the page works without them. */
export async function loadRoundNames(
  roundId: string,
): Promise<{ round: Round; programme: Programme } | null> {
  try {
    const round = await call(getRound, { params: { roundId } });
    const programme = await call(getProgramme, { params: { programmeId: round.programmeId } });
    return { round, programme };
  } catch (error) {
    if (error instanceof ProblemError) return null;
    throw error;
  }
}

export async function loadSpreadPage(roundId: string) {
  const [spread, names] = await Promise.all([
    call(getScoreSpread, { params: { roundId } }),
    loadRoundNames(roundId),
  ]);
  return { rows: spread.submissions, names };
}

export const loadScores = (submissionId: string) =>
  call(getSubmissionScores, { params: { submissionId } });

export const loadReviews = () => call(listReviews, {});

/** One of the caller's reviews, or null when there is none: it is not theirs, it ended in a conflict, or it never existed. */
export async function loadReview(assignmentId: string) {
  try {
    return await call(getReview, { params: { assignmentId } });
  } catch (error) {
    if (error instanceof ProblemError && error.status === 404) return null;
    throw error;
  }
}

export const saveScores = (assignmentId: string, body: ScoresInput) =>
  call(saveReviewScores, { params: { assignmentId }, body });

export const submitScores = (assignmentId: string, body: ScoresInput) =>
  call(submitReview, { params: { assignmentId }, body });

export const declare = (assignmentId: string) =>
  call(declareConflict, { params: { assignmentId } });
