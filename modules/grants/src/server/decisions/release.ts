// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Releasing decisions and queuing their emails (ADR 0004, ADR 0010, ADR 0020,
// architecture rules 8 and 9). The routes need a sign-in in the last five
// minutes, which the platform has checked. In one transaction, each chosen
// recorded decision is released, gets one email waiting to send with the
// programme's latest template for its outcome, records its release, and has
// a job queued to send the email (send.ts). The worker sends it, so a slow
// or failing mail server never delays or undoes a release. Only a named
// person's request releases anything.

import type { ReleaseInput, ReleaseResult, EmailDelivery } from '../../contracts/index.ts';
import { publishDecisionReleased } from '../events/index.ts';
import type { DecisionArgs, DecisionDependencies } from './context.ts';
import { queueEmails } from './send.ts';
import { decisionsDb } from './tables.ts';

const refusals = {
  notReleasable:
    'This submission has no decision waiting to be released in this round. Remove it and try again.',
  none: 'No decisions were released. Remove the ones listed and try again.',
} as const;

export function releaseHandlers(deps: DecisionDependencies) {
  async function releaseDecisions({
    tx,
    context,
    input,
  }: DecisionArgs<{ params: { roundId: string }; body: ReleaseInput }>): Promise<ReleaseResult> {
    const { roundId } = input.params;
    const db = decisionsDb(tx);
    const round = await db
      .selectFrom('grants.round')
      .select('programme_id')
      .where('id', '=', roundId)
      .executeTakeFirst();
    if (round === undefined) throw deps.notFound();

    // Recorded, unreleased decisions of submitted applications, locked in id order.
    let query = db
      .selectFrom('grants.decision as d')
      .innerJoin('grants.application as a', 'a.id', 'd.application_id')
      .select([
        'd.id',
        'd.outcome',
        'a.id as application_id',
        'a.organisation_id',
        'a.applicant_person_id',
      ])
      .where('a.round_id', '=', roundId)
      .where('a.status', '=', 'submitted')
      .where('d.released_at', 'is', null);
    if (input.body.release === 'chosen') {
      query = query.where('a.id', 'in', input.body.submissionIds);
    }
    const decisions = await query.orderBy('d.id').forUpdate('d').execute();

    if (input.body.release === 'chosen') {
      const found = new Set(decisions.map((decision) => decision.application_id));
      const problems = input.body.submissionIds.flatMap((id, index) =>
        found.has(id)
          ? []
          : [{ field: `body.submissionIds.${index}`, message: refusals.notReleasable }],
      );
      if (problems.length > 0) throw deps.refuse(409, refusals.none, problems);
    }

    if (decisions.length > 0) {
      const templates = new Map(
        (
          await db
            .selectFrom('grants.email_template_version')
            .select(['id', 'outcome'])
            .distinctOn('outcome')
            .where('programme_id', '=', round.programme_id)
            .orderBy('outcome')
            .orderBy('version', 'desc')
            .execute()
        ).map((template) => [template.outcome, template.id]),
      );
      const actor = context.membership.id;
      for (const decision of decisions) {
        const released = await db
          .updateTable('grants.decision')
          .set({ released_by: actor, updated_by: actor })
          .where('id', '=', decision.id)
          .returning('released_at')
          .executeTakeFirstOrThrow();
        await context.audit.record({
          action: 'grants.decision.released',
          entityId: decision.id,
          changes: {
            'grants.decision.released_by': { before: null, after: actor },
            'grants.decision.released_at': {
              before: null,
              after: released.released_at?.toISOString() ?? null,
            },
          },
        });
        if (released.released_at === null) throw new Error('The release time was not set.');
        await publishDecisionReleased(
          tx,
          deps,
          { requestId: context.requestId, membershipId: actor },
          {
            id: decision.id,
            applicationId: decision.application_id,
            roundId,
            organisationId: decision.organisation_id,
            recipientPersonId: decision.applicant_person_id,
            releasedAt: released.released_at,
          },
        );
      }
      const emails = await db
        .insertInto('grants.decision_email')
        .values((eb) =>
          decisions.map((decision) => ({
            tenant_id: eb.fn<string>('app.current_tenant_id', []),
            decision_id: decision.id,
            recipient_person_id: decision.applicant_person_id,
            template_version_id:
              templates.get(decision.outcome) ??
              (() => {
                throw new Error('The programme has no email template for this outcome.');
              })(),
            created_by: actor,
            updated_by: actor,
          })),
        )
        .returning('id')
        .execute();
      await queueEmails(
        tx,
        deps,
        context,
        emails.map(({ id }) => id),
      );
    }
    return { released: decisions.length, sent: 0, failed: 0, pending: decisions.length };
  }

  async function sendDecisionEmails({
    tx,
    context,
    input,
  }: DecisionArgs<{ params: { roundId: string } }>): Promise<EmailDelivery> {
    const { roundId } = input.params;
    const db = decisionsDb(tx);
    const round = await db
      .selectFrom('grants.round')
      .select('id')
      .where('id', '=', roundId)
      .executeTakeFirst();
    if (round === undefined) throw deps.notFound();

    // The round's unsent emails: waiting to send, or failed. Each is queued, and recorded as resent if its job was added.
    const unsent = await db
      .selectFrom('grants.decision_email as e')
      .innerJoin('grants.decision as d', 'd.id', 'e.decision_id')
      .innerJoin('grants.application as a', 'a.id', 'd.application_id')
      .select('e.id')
      .where('a.round_id', '=', roundId)
      .where('e.status', 'in', ['pending', 'failed'])
      .orderBy('e.id')
      .execute();
    const queued = await queueEmails(
      tx,
      deps,
      context,
      unsent.map(({ id }) => id),
    );
    for (const id of queued) {
      await context.audit.record({ action: 'grants.decision_email.resent', entityId: id });
    }
    return { sent: 0, failed: 0, pending: unsent.length };
  }

  return { releaseDecisions, sendDecisionEmails };
}
