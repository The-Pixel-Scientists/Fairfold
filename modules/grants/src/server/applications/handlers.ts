// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The applicant's application routes (ADR 0004), matched with their contracts
// in apps/api/src/modules.ts. Everything is checked again here: the
// organisation is one the caller is a current contact for, answers are checked
// against the pinned form version, and a client never says who is applying.
// Autosaves are not audited, being the applicant's own unsubmitted work.
// Submitting and withdrawing are in submit.ts.

import {
  checkEligibility,
  questionsOf,
  validateAnswers,
  type Answers,
  type FormDefinition,
} from '@pixel-scientists/domain/forms';
import { messages, type FieldProblem } from '@pixel-scientists/domain/platform';
import { ensurePersonForUser, isCurrentContact } from '@pixel-scientists/party/server';

import type {
  AnswersSaved,
  Application,
  ApplicationList,
  Eligibility,
  OpenRoundDetail,
  OpenRoundList,
  SaveAnswersInput,
  StartApplicationInput,
} from '../../contracts/index.ts';
import { isDuplicate } from '../forms/tables.ts';
import type { RoundParams } from '../programme/context.ts';
import type { ApplicationArgs, ApplicationDependencies, ApplicationParams } from './context.ts';
import { checkDraft, lockOwn, refusals } from './lock.ts';
import { answersWithFiles, ownApplication, readApplications } from './read.ts';
import { latestPublishedForm, readOpenRound, readOpenRounds } from './rounds.ts';
import { submitHandlers } from './submit.ts';
import { applicationsDb } from './tables.ts';

const column = (name: string) => `grants.application.${name}`;

/** A problem for each answer to a file question, whose files only the server links. */
function fileProblems(definition: FormDefinition, answers: Answers): FieldProblem[] {
  return questionsOf(definition).flatMap((field) =>
    field.type === 'file' && Object.hasOwn(answers, field.id)
      ? [{ field: field.id, message: refusals.fileAnswer }]
      : [],
  );
}

export function applicationHandlers(deps: ApplicationDependencies) {
  async function listOpenRounds({ tx }: ApplicationArgs<unknown>): Promise<OpenRoundList> {
    return { rounds: await readOpenRounds(tx) };
  }

  async function getOpenRound({
    tx,
    input,
  }: ApplicationArgs<RoundParams>): Promise<OpenRoundDetail> {
    return (await readOpenRound(tx, input.params.roundId)) ?? Promise.reject(deps.notFound());
  }

  async function startApplication({
    tx,
    context,
    input,
  }: ApplicationArgs<RoundParams & { body: StartApplicationInput }>): Promise<Application> {
    const { roundId } = input.params;
    const { organisationId } = input.body;
    const { personId, created } = await ensurePersonForUser(tx, {
      userId: context.session.userId,
      email: await context.session.email(),
    });
    if (created) {
      await context.audit.record({
        action: 'party.person.created',
        entityId: personId,
        changes: { 'party.person.email': {}, 'party.person.user_id': {} },
      });
    }
    // An organisation the caller is no contact for reads exactly as a missing one.
    if (!(await isCurrentContact(tx, personId, organisationId))) throw deps.notFound();
    const form = await latestPublishedForm(tx, roundId);
    if (form === undefined) throw deps.notFound();

    const actor = context.membership.id;
    let id: string;
    try {
      ({ id } = await applicationsDb(tx)
        .insertInto('grants.application')
        .values((eb) => ({
          tenant_id: eb.fn<string>('app.current_tenant_id', []),
          round_id: roundId,
          form_version_id: form.id,
          applicant_person_id: personId,
          organisation_id: organisationId,
          created_by: actor,
          updated_by: actor,
        }))
        .returning('id')
        .executeTakeFirstOrThrow());
    } catch (error) {
      // The organisation's application for this round was started first.
      throw isDuplicate(error) ? deps.refuse(409, refusals.exists) : error;
    }
    await context.audit.record({
      action: 'grants.application.created',
      entityId: id,
      changes: {
        [column('round_id')]: { before: null, after: roundId },
        [column('form_version_id')]: { before: null, after: form.id },
        [column('organisation_id')]: { before: null, after: organisationId },
        [column('status')]: { before: null, after: 'draft' },
      },
    });
    return ownApplication(tx, deps, context.session.userId, id);
  }

  async function listApplications({
    tx,
    context,
  }: ApplicationArgs<unknown>): Promise<ApplicationList> {
    return { applications: await readApplications(tx, context.session.userId) };
  }

  async function getApplication({
    tx,
    context,
    input,
  }: ApplicationArgs<ApplicationParams>): Promise<Application> {
    return ownApplication(tx, deps, context.session.userId, input.params.applicationId);
  }

  async function saveApplicationAnswers({
    tx,
    context,
    input,
  }: ApplicationArgs<ApplicationParams & { body: SaveAnswersInput }>): Promise<AnswersSaved> {
    const { applicationId } = input.params;
    const { basedOn, answers } = input.body;
    const application = await lockOwn(tx, deps, context.session.userId, applicationId);
    checkDraft(deps, application, basedOn);

    const { definition } = application;
    const problems = [
      ...fileProblems(definition, answers),
      ...validateAnswers(definition, answers, 'draft'),
    ];
    if (problems.length > 0) throw deps.refuse(400, messages.fixFields, problems);

    const saved = await applicationsDb(tx)
      .updateTable('grants.application')
      .set((eb) => ({
        answers: JSON.stringify(answers),
        answers_version: eb('answers_version', '+', 1),
        updated_by: context.membership.id,
      }))
      .where('id', '=', applicationId)
      .returning(['answers_version', 'updated_at'])
      .executeTakeFirstOrThrow();
    return { answersVersion: saved.answers_version, updatedAt: saved.updated_at.toISOString() };
  }

  async function checkApplicationEligibility({
    tx,
    context,
    input,
  }: ApplicationArgs<ApplicationParams>): Promise<Eligibility> {
    const { applicationId } = input.params;
    const application = await lockOwn(tx, deps, context.session.userId, applicationId);
    if (application.status !== 'draft') throw deps.refuse(409, refusals.notDraft);

    const answers = await answersWithFiles(tx, applicationId, application.answers);
    const result = checkEligibility(application.definition, answers);
    if (result.status === 'incomplete') return result;

    const stoppingField = result.status === 'stopped' ? result.fieldId : null;
    await applicationsDb(tx)
      .insertInto('grants.eligibility_result')
      .values((eb) => ({
        tenant_id: eb.fn<string>('app.current_tenant_id', []),
        application_id: applicationId,
        form_version_id: application.formVersionId,
        outcome: result.status,
        stopping_field_id: stoppingField,
        checked_by: context.membership.id,
      }))
      .execute();
    await context.audit.record({
      action: 'grants.application.eligibility_checked',
      entityId: applicationId,
      changes: {
        'grants.eligibility_result.outcome': { before: null, after: result.status },
        'grants.eligibility_result.stopping_field_id': { before: null, after: stoppingField },
      },
    });
    return result;
  }

  return {
    listOpenRounds,
    getOpenRound,
    startApplication,
    listApplications,
    getApplication,
    saveApplicationAnswers,
    checkApplicationEligibility,
    ...submitHandlers(deps),
  };
}
