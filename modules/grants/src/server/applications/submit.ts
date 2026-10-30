// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Submitting and withdrawing (ADR 0004, architecture rules 6 to 8). Submitting
// checks the saved answers, never the client's view of what is shown or
// eligible: the answers are checked in `submit` mode against the pinned form
// version and its eligibility questions. The round must be taking applications
// (its programme open and its opening time passed), and its closing time is
// read by the database's clock: a late submission is refused or marked late, as
// the round's late policy says. The first stage is set by the server.

import { checkEligibility, validateAnswers } from '@pixel-scientists/domain/forms';
import { messages } from '@pixel-scientists/domain/platform';

import type { Application, SubmitApplicationInput } from '../../contracts/index.ts';
import type { Tx } from '../programme/tables.ts';
import type { ApplicationArgs, ApplicationDependencies, ApplicationParams } from './context.ts';
import { checkDraft, lockOwn, refusals } from './lock.ts';
import { answersWithFiles, ownApplication } from './read.ts';
import { applicationsDb } from './tables.ts';

const column = (name: string) => `grants.application.${name}`;

/** `3 November 2026 at 17:00`, on the wall clock of the round's zone. */
function closingWords(closesAt: Date, zone: string): string {
  const at = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: zone, ...options }).format(closesAt);
  const date = at({ day: 'numeric', month: 'long', year: 'numeric' });
  return `${date} at ${at({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}`;
}

/**
 * Whether the round is taking applications (its programme is open and its
 * opening time has passed), its closing time, whether the database's clock is
 * past it, and its late policy.
 */
export async function closing(tx: Tx, roundId: string) {
  return applicationsDb(tx)
    .selectFrom('grants.round as r')
    .innerJoin('grants.programme as p', 'p.id', 'r.programme_id')
    .select((eb) => [
      'r.closes_at',
      'r.timezone',
      'r.late_policy',
      eb
        .and([eb('p.status', '=', 'open'), eb('r.opens_at', '<=', eb.fn<Date>('now', []))])
        .as('taking'),
      eb('r.closes_at', '<=', eb.fn<Date>('now', [])).as('closed'),
    ])
    .where('r.id', '=', roundId)
    .executeTakeFirstOrThrow();
}

export function submitHandlers(deps: ApplicationDependencies) {
  async function submitApplication({
    tx,
    context,
    input,
  }: ApplicationArgs<ApplicationParams & { body: SubmitApplicationInput }>): Promise<Application> {
    const { userId } = context.session;
    const { applicationId } = input.params;
    const application = await lockOwn(tx, deps, userId, applicationId);
    checkDraft(deps, application, input.body.basedOn);

    const round = await closing(tx, application.roundId);
    if (!round.taking) throw deps.notFound();
    const late = Boolean(round.closed);
    if (late && round.late_policy === 'refuse') {
      throw deps.refuse(
        400,
        `This round closed on ${closingWords(round.closes_at, round.timezone)}.`,
      );
    }

    const { definition } = application;
    const answers = await answersWithFiles(tx, applicationId, application.answers);
    const problems = validateAnswers(definition, answers, 'submit');
    if (problems.length > 0) throw deps.refuse(400, messages.fixFields, problems);
    const eligibility = checkEligibility(definition, answers);
    if (eligibility.status === 'stopped') {
      const { fieldId, explanation } = eligibility;
      throw deps.refuse(400, explanation, [{ field: fieldId, message: explanation }]);
    }
    if (eligibility.status === 'incomplete') throw deps.refuse(400, refusals.notEligible);

    const db = applicationsDb(tx);
    const first = await db
      .selectFrom('grants.stage')
      .select('id')
      .where('round_id', '=', application.roundId)
      .orderBy('position')
      .limit(1)
      .executeTakeFirst();
    if (first === undefined) throw deps.notFound();

    const actor = context.membership.id;
    await db
      .updateTable('grants.application')
      .set({
        status: 'submitted',
        stage_id: first.id,
        submitted_late: late,
        updated_by: actor,
      })
      .where('id', '=', applicationId)
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('grants.stage_transition')
      .values((eb) => ({
        tenant_id: eb.fn<string>('app.current_tenant_id', []),
        round_id: application.roundId,
        application_id: applicationId,
        from_stage_id: null,
        to_stage_id: first.id,
        moved_by: actor,
      }))
      .execute();
    await context.audit.record({
      action: 'grants.application.submitted',
      entityId: applicationId,
      changes: {
        [column('status')]: { before: 'draft', after: 'submitted' },
        [column('stage_id')]: { before: null, after: first.id },
        [column('submitted_late')]: { before: false, after: late },
      },
    });
    return ownApplication(tx, deps, userId, applicationId);
  }

  async function withdrawApplication({
    tx,
    context,
    input,
  }: ApplicationArgs<ApplicationParams>): Promise<Application> {
    const { userId } = context.session;
    const { applicationId } = input.params;
    const application = await lockOwn(tx, deps, userId, applicationId);
    if (application.status !== 'submitted') throw deps.refuse(409, refusals.notSubmitted);
    // A released decision stands. Only that one is read, so an unreleased one stays private.
    const decided = await applicationsDb(tx)
      .selectFrom('grants.decision')
      .select('application_id')
      .where('application_id', '=', applicationId)
      .where('released_at', 'is not', null)
      .executeTakeFirst();
    if (decided !== undefined) throw deps.refuse(409, refusals.decided);

    await applicationsDb(tx)
      .updateTable('grants.application')
      .set({ status: 'withdrawn', updated_by: context.membership.id })
      .where('id', '=', applicationId)
      .returning('id')
      .executeTakeFirstOrThrow();
    await context.audit.record({
      action: 'grants.application.withdrawn',
      entityId: applicationId,
      changes: { [column('status')]: { before: 'submitted', after: 'withdrawn' } },
    });
    return ownApplication(tx, deps, userId, applicationId);
  }

  return { submitApplication, withdrawApplication };
}
