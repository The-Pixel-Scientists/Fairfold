// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What saving and checking a draft do, for the applicant's routes and for
// staff acting for the applicant on the alternative route: one set of rules,
// whoever is acting. The acting member is the session's.

import {
  checkEligibility,
  cleanAnswers,
  questionsOf,
  validateAnswers,
  type Answers,
  type FormDefinition,
} from '@pixel-scientists/domain/forms';
import { messages, type FieldProblem } from '@pixel-scientists/domain/platform';

import type { AnswersSaved, Eligibility, SaveAnswersInput } from '../../contracts/index.ts';
import type { ActingContext, ApplicationDependencies } from './context.ts';
import { checkDraft, refusals, type LockedApplication } from './lock.ts';
import { answersWithFiles } from './read.ts';
import { applicationsDb } from './tables.ts';
import type { Tx } from '../programme/tables.ts';

/** A problem for each answer to a file question, whose files only the server links. */
function fileProblems(definition: FormDefinition, answers: Answers): FieldProblem[] {
  return questionsOf(definition).flatMap((field) =>
    field.type === 'file' && Object.hasOwn(answers, field.id)
      ? [{ field: field.id, message: refusals.fileAnswer }]
      : [],
  );
}

/** Replaces a draft's answers with the cleaned answers, and returns them with the new version. */
export async function saveDraft(
  tx: Tx,
  deps: ApplicationDependencies,
  application: LockedApplication,
  actor: string,
  body: SaveAnswersInput,
): Promise<{ saved: AnswersSaved; answers: Answers }> {
  checkDraft(deps, application, body.basedOn);
  const { definition } = application;
  const answers = cleanAnswers(definition, body.answers);
  const forbidden = fileProblems(definition, answers);
  const problems = forbidden.length > 0 ? forbidden : validateAnswers(definition, answers, 'draft');
  if (problems.length > 0) throw deps.refuse(400, messages.fixFields, problems);

  const saved = await applicationsDb(tx)
    .updateTable('grants.application')
    .set((eb) => ({
      answers: JSON.stringify(answers),
      answers_version: eb('answers_version', '+', 1),
      updated_by: actor,
    }))
    .where('id', '=', application.id)
    .returning(['answers_version', 'updated_at'])
    .executeTakeFirstOrThrow();
  return {
    saved: { answersVersion: saved.answers_version, updatedAt: saved.updated_at.toISOString() },
    answers,
  };
}

/** Checks a draft's saved answers, recording and auditing an eligible or stopped result. */
export async function checkDraftEligibility(
  tx: Tx,
  deps: ApplicationDependencies,
  context: ActingContext,
  application: LockedApplication,
): Promise<Eligibility> {
  if (application.status !== 'draft') throw deps.refuse(409, refusals.notDraft);

  const answers = await answersWithFiles(tx, application.id, application.answers);
  const result = checkEligibility(application.definition, answers);
  if (result.status === 'incomplete') return result;

  const stoppingField = result.status === 'stopped' ? result.fieldId : null;
  await applicationsDb(tx)
    .insertInto('grants.eligibility_result')
    .values((eb) => ({
      tenant_id: eb.fn<string>('app.current_tenant_id', []),
      application_id: application.id,
      form_version_id: application.formVersionId,
      outcome: result.status,
      stopping_field_id: stoppingField,
      checked_by: context.membership.id,
    }))
    .execute();
  await context.audit.record({
    action: 'grants.application.eligibility_checked',
    entityId: application.id,
    changes: {
      'grants.eligibility_result.outcome': { before: null, after: result.status },
      'grants.eligibility_result.stopping_field_id': { before: null, after: stoppingField },
    },
  });
  return result;
}
