// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the decision pages read and send. Defined once, here, so useLoad
// reads again only when a page asks it to.

import { call } from '@pixel-scientists/domain/api';

import {
  listDecisions,
  MAX_DECISIONS,
  previewDecisionEmail,
  recordDecision,
  recordDecisions,
  releaseDecisions,
  sendDecisionEmails,
} from '../../contracts/index.ts';
import type { DecisionInput } from '../../contracts/index.ts';
import { loadRoundNames } from '../assessment/loaders.ts';

export const loadDecisions = (roundId: string) => call(listDecisions, { params: { roundId } });

/** A round's decisions, and its programme's name when it can be read: the page works without it. */
export async function loadDecisionPage(roundId: string) {
  const [list, names] = await Promise.all([loadDecisions(roundId), loadRoundNames(roundId)]);
  return { list, programme: names?.programme ?? null };
}

export type DecisionPage = Awaited<ReturnType<typeof loadDecisionPage>>;

export const record = (submissionId: string, body: DecisionInput) =>
  call(recordDecision, { params: { submissionId }, body });

export const recordMany = (
  roundId: string,
  decisions: readonly { submissionId: string; decision: DecisionInput }[],
) => call(recordDecisions, { params: { roundId }, body: { decisions: [...decisions] } });

export const loadEmail = (submissionId: string) =>
  call(previewDecisionEmail, { params: { submissionId } });

/**
 * Releases the decisions the person has just checked, by name. A round with
 * more than a request may name is released as a whole instead.
 */
export const releaseChecked = (roundId: string, submissionIds: readonly string[]) =>
  call(releaseDecisions, {
    params: { roundId },
    body:
      submissionIds.length <= MAX_DECISIONS
        ? { release: 'chosen', submissionIds: [...submissionIds] }
        : { release: 'all' },
  });

export const sendUnsent = (roundId: string) => call(sendDecisionEmails, { params: { roundId } });
