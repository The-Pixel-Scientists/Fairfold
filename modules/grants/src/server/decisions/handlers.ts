// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The decision routes' handlers (ADR 0004), matched with their contracts in
// apps/api/src/modules.ts. These are for staff only: an applicant sees a
// decision through the application routes, once it is released.

import { renderTemplate, type DecisionList, type EmailPreview } from '../../contracts/index.ts';
import { readTemplates } from '../programme/read.ts';
import type { DecisionArgs, DecisionDependencies } from './context.ts';
import { mergeValuesFor } from './email.ts';
import { readDecisionList } from './read.ts';
import { recordHandlers } from './record.ts';
import { releaseHandlers } from './release.ts';
import { decisionsDb } from './tables.ts';

export function decisionHandlers(deps: DecisionDependencies) {
  async function listDecisions({
    tx,
    input,
  }: DecisionArgs<{ params: { roundId: string } }>): Promise<DecisionList> {
    return (await readDecisionList(tx, input.params.roundId)) ?? Promise.reject(deps.notFound());
  }

  /** The email as the programme's latest template for the outcome would fill it; staff only. */
  async function previewDecisionEmail({
    tx,
    input,
  }: DecisionArgs<{ params: { submissionId: string } }>): Promise<EmailPreview> {
    const row = await decisionsDb(tx)
      .selectFrom('grants.decision as d')
      .innerJoin('grants.application as a', 'a.id', 'd.application_id')
      .innerJoin('grants.round as r', 'r.id', 'a.round_id')
      .innerJoin('grants.programme as p', 'p.id', 'r.programme_id')
      .select([
        'd.outcome',
        'd.amount_minor',
        'a.applicant_person_id as recipient_person_id',
        'a.organisation_id',
        'p.id as programme_id',
        'p.title as programme_title',
        'r.title as round_title',
      ])
      .where('a.id', '=', input.params.submissionId)
      .executeTakeFirst();
    if (row === undefined) throw deps.notFound();
    const { values } = await mergeValuesFor(tx, deps.portalOrigin, row);
    const template = (await readTemplates(tx, row.programme_id))[row.outcome];
    return renderTemplate({ outcome: row.outcome, ...template }, values);
  }

  return {
    listDecisions,
    previewDecisionEmail,
    ...recordHandlers(deps),
    ...releaseHandlers(deps),
  };
}
