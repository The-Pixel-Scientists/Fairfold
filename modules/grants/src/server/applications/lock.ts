// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Finding the applicant's own application to change it. The row is locked
// until the request ends, so two requests on one application take turns and
// a second tab never overwrites the first. The query names the applicant, so
// an application of anyone else is not there, as the scope rule already says.

import type { FormDefinition } from '@pixel-scientists/domain/forms';
import { personIdForUser } from '@pixel-scientists/party/server';

import type { ApplicationStatus } from '../../contracts/index.ts';
import { definitionOf, findVersion } from '../forms/read.ts';
import type { Tx } from '../programme/tables.ts';
import type { ApplicationDependencies } from './context.ts';
import { applicationsDb } from './tables.ts';

export const refusals = {
  notDraft: 'This application has been submitted, so its answers can no longer change.',
  stale:
    'These answers have changed since you opened them. Reload the page to see the latest answers.',
  exists: 'This organisation has already started an application for this round.',
  notSubmitted: 'Only a submitted application can be withdrawn.',
  fileAnswer: 'Add files to this question by uploading them, not with the answers.',
  decided: 'This application has an outcome, so it can no longer be withdrawn.',
  notEligible: 'Check you can apply before you submit.',
} as const;

export interface LockedApplication {
  readonly id: string;
  readonly status: ApplicationStatus;
  readonly answers: unknown;
  readonly answersVersion: number;
  readonly formVersionId: string;
  readonly roundId: string;
  readonly definition: FormDefinition;
}

/** With `lock` false, the application is read without waiting for other requests on it. */
export async function lockOwn(
  tx: Tx,
  deps: ApplicationDependencies,
  userId: string,
  applicationId: string,
  lock = true,
): Promise<LockedApplication> {
  const personId = await personIdForUser(tx, userId);
  const row =
    personId === null
      ? undefined
      : await applicationsDb(tx)
          .selectFrom('grants.application')
          .select(['id', 'status', 'answers', 'answers_version', 'form_version_id', 'round_id'])
          .where('id', '=', applicationId)
          .where('applicant_person_id', '=', personId)
          .$if(lock, (query) => query.forUpdate())
          .executeTakeFirst();
  const version = row === undefined ? undefined : await findVersion(tx, row.form_version_id);
  const definition = definitionOf(version?.definition ?? null);
  if (row === undefined || definition === null) throw deps.notFound();
  return {
    id: row.id,
    status: row.status,
    answers: row.answers,
    answersVersion: row.answers_version,
    formVersionId: row.form_version_id,
    roundId: row.round_id,
    definition,
  };
}

/** The application as a draft, based on the answers version the applicant last saw. */
export function checkDraft(
  deps: ApplicationDependencies,
  application: LockedApplication,
  basedOn: number,
): void {
  if (application.status !== 'draft') throw deps.refuse(409, refusals.notDraft);
  if (application.answersVersion !== basedOn) throw deps.refuse(409, refusals.stale);
}
