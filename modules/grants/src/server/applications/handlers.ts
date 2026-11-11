// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The applicant's application routes (ADR 0004), matched with their contracts
// in apps/api/src/modules.ts. Everything is checked again here: the
// organisation is one the caller is a current contact for, answers are checked
// against the pinned form version, and a client never says who is applying.
// Autosaves are not audited, being the applicant's own unsubmitted work.
// Submitting and withdrawing are in submit.ts.

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
import { checkDraftEligibility, saveDraft } from './draft.ts';
import { lockOwn, refusals } from './lock.ts';
import { ownApplication, readApplications } from './read.ts';
import {
  acceptsApplication,
  latestPublishedForm,
  readOpenRound,
  readOpenRounds,
} from './rounds.ts';
import { submitHandlers } from './submit.ts';
import { applicationsDb } from './tables.ts';

const column = (name: string) => `grants.application.${name}`;

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
    if (!(await acceptsApplication(tx, roundId, organisationId))) throw deps.notFound();
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
    const application = await lockOwn(tx, deps, context.session.userId, input.params.applicationId);
    return (await saveDraft(tx, deps, application, context.membership.id, input.body)).saved;
  }

  async function checkApplicationEligibility({
    tx,
    context,
    input,
  }: ApplicationArgs<ApplicationParams>): Promise<Eligibility> {
    const application = await lockOwn(tx, deps, context.session.userId, input.params.applicationId);
    return checkDraftEligibility(tx, deps, context, application);
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
