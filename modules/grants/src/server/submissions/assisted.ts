// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The alternative route (ADR 0004, architecture rules 6 and 9): a member
// starts, fills in and submits an application for an organisation that
// staff have given the alternative route in the round. The member acts for
// the applicant and is never the applicant: the applicant is the contact
// person named at the start, and the member is recorded as the submitter,
// from the session alone. The live adjustment is checked here before the
// database's trigger, which stays the backstop. Saving, checking and
// submitting are the portal's own functions, so both routes refuse the same
// answers. Every change is audited with the member as actor.

import { isCurrentContact, organisationSummaries } from '@pixel-scientists/party/server';

import {
  adjustmentMessages,
  type AnswersSaved,
  type AssistedApplication,
  type AssistedList,
  type Eligibility,
  type SaveAnswersInput,
  type StartAssistedInput,
  type Submission,
  type SubmitApplicationInput,
} from '../../contracts/index.ts';
import { checkDraftEligibility, saveDraft } from '../applications/draft.ts';
import { lockAssisted } from '../applications/lock.ts';
import { acceptsApplication, latestPublishedForm } from '../applications/rounds.ts';
import { submitDraft } from '../applications/submit.ts';
import { applicationsDb } from '../applications/tables.ts';
import { isDuplicate } from '../forms/tables.ts';
import type { Tx } from '../programme/tables.ts';
import { readAssisted, readAssistedList } from './assisted-read.ts';
import type { SubmissionArgs, SubmissionDependencies } from './context.ts';
import { readSubmission } from './read.ts';

const refusals = {
  closed:
    'This round is not taking applications from this organisation. Give it more time first, then start again.',
} as const;

const column = (name: string) => `grants.application.${name}`;

type DraftParams = { params: { applicationId: string } };

/** The field ids whose answers differ between two saves, which an audit event may name. */
function changedFields(before: unknown, after: object): string[] {
  const was = (before ?? {}) as Record<string, unknown>;
  const now = after as Record<string, unknown>;
  return [...new Set([...Object.keys(was), ...Object.keys(now)])].filter(
    (id) => JSON.stringify(was[id] ?? null) !== JSON.stringify(now[id] ?? null),
  );
}

export function assistedHandlers(deps: SubmissionDependencies) {
  /** Refused unless the organisation has a live alternative route in the round. */
  async function requireAlternativeRoute(tx: Tx, roundId: string, organisationId: string) {
    const live = await applicationsDb(tx)
      .selectFrom('grants.adjustment')
      .select('id')
      .where('round_id', '=', roundId)
      .where('organisation_id', '=', organisationId)
      .where('kind', '=', 'alternative_route')
      .where('revoked_at', 'is', null)
      .executeTakeFirst();
    if (live === undefined) throw deps.refuse(409, adjustmentMessages.noAlternativeRoute);
  }

  /** The assisted application, or a 404; the alternative route is checked on the way. */
  async function lockLive(tx: Tx, applicationId: string) {
    const application = await lockAssisted(tx, deps, applicationId);
    await requireAlternativeRoute(tx, application.roundId, application.organisationId);
    return application;
  }

  async function listAssistedApplications({
    tx,
    input,
  }: SubmissionArgs<{ params: { roundId: string } }>): Promise<AssistedList> {
    const round = await applicationsDb(tx)
      .selectFrom('grants.round')
      .select('id')
      .where('id', '=', input.params.roundId)
      .executeTakeFirst();
    if (round === undefined) throw deps.notFound();
    return readAssistedList(tx, round.id);
  }

  async function startAssistedApplication({
    tx,
    context,
    input,
  }: SubmissionArgs<{
    params: { roundId: string };
    body: StartAssistedInput;
  }>): Promise<AssistedApplication> {
    const { roundId } = input.params;
    const { organisationId, contactPersonId } = input.body;
    const round = await applicationsDb(tx)
      .selectFrom('grants.round')
      .select('id')
      .where('id', '=', roundId)
      .executeTakeFirst();
    const [organisation] = await organisationSummaries(tx, [organisationId]);
    if (round === undefined || organisation === undefined) throw deps.notFound();
    await requireAlternativeRoute(tx, roundId, organisationId);
    if (!(await isCurrentContact(tx, contactPersonId, organisationId))) {
      const message = adjustmentMessages.notContact;
      throw deps.refuse(400, message, [{ field: 'body.contactPersonId', message }]);
    }
    if (!(await acceptsApplication(tx, roundId, organisationId))) {
      throw deps.refuse(409, refusals.closed);
    }
    const form = await latestPublishedForm(tx, roundId);
    if (form === undefined) throw deps.notFound();

    const actor = context.membership.id;
    const db = applicationsDb(tx);
    let id: string;
    try {
      ({ id } = await db
        .insertInto('grants.application')
        .values((eb) => ({
          tenant_id: eb.fn<string>('app.current_tenant_id', []),
          round_id: roundId,
          form_version_id: form.id,
          applicant_person_id: contactPersonId,
          organisation_id: organisationId,
          created_by: actor,
          updated_by: actor,
        }))
        .returning('id')
        .executeTakeFirstOrThrow());
    } catch (error) {
      throw isDuplicate(error) ? deps.refuse(409, adjustmentMessages.alreadyApplying) : error;
    }
    // The route is set while the application is still a draft, in the same transaction.
    await db
      .updateTable('grants.application')
      .set({ submission_route: 'assisted' })
      .where('id', '=', id)
      .execute();
    await context.audit.record({
      action: 'grants.application.created',
      entityId: id,
      changes: {
        [column('round_id')]: { before: null, after: roundId },
        [column('form_version_id')]: { before: null, after: form.id },
        [column('organisation_id')]: { before: null, after: organisationId },
        [column('status')]: { before: null, after: 'draft' },
        [column('submission_route')]: { before: null, after: 'assisted' },
      },
    });
    return (await readAssisted(tx, id)) ?? Promise.reject(deps.notFound());
  }

  async function getAssistedApplication({
    tx,
    context,
    input,
  }: SubmissionArgs<DraftParams>): Promise<AssistedApplication> {
    const { applicationId } = input.params;
    const application = await readAssisted(tx, applicationId);
    if (application === undefined) throw deps.notFound();
    await context.audit.read({ action: 'grants.application.viewed', entityId: applicationId });
    return application;
  }

  async function saveAssistedAnswers({
    tx,
    context,
    input,
  }: SubmissionArgs<DraftParams & { body: SaveAnswersInput }>): Promise<AnswersSaved> {
    const application = await lockLive(tx, input.params.applicationId);
    const { saved, answers } = await saveDraft(
      tx,
      deps,
      application,
      context.membership.id,
      input.body,
    );
    await context.audit.record({
      action: 'grants.application.answers_saved_on_behalf',
      entityId: application.id,
      changes: {
        [column('answers_version')]: {
          before: application.answersVersion,
          after: saved.answersVersion,
        },
        ...Object.fromEntries(changedFields(application.answers, answers).map((id) => [id, {}])),
      },
    });
    return saved;
  }

  async function checkAssistedEligibility({
    tx,
    context,
    input,
  }: SubmissionArgs<DraftParams>): Promise<Eligibility> {
    const application = await lockLive(tx, input.params.applicationId);
    return checkDraftEligibility(tx, deps, context, application);
  }

  async function submitAssistedApplication({
    tx,
    context,
    input,
  }: SubmissionArgs<DraftParams & { body: SubmitApplicationInput }>): Promise<Submission> {
    const application = await lockLive(tx, input.params.applicationId);
    await submitDraft(tx, deps, context, application, input.body.basedOn, 'assisted');
    return (await readSubmission(tx, application.id)) ?? Promise.reject(deps.notFound());
  }

  return {
    listAssistedApplications,
    startAssistedApplication,
    getAssistedApplication,
    saveAssistedAnswers,
    checkAssistedEligibility,
    submitAssistedApplication,
  };
}
