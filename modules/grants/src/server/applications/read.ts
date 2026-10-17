// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Reading an applicant's applications as the contracts answer them. Answers
// are projected for the applicant from the pinned form version, and the
// status is what applicantStatus() says: no stage, score or decision shows
// here, and `outcome` stays null until a decision is released.

import { projectedAnswers } from '@pixel-scientists/domain/api';
import { checkEligibility, type Answers } from '@pixel-scientists/domain/forms';
import { organisationSummaries, personIdForUser } from '@pixel-scientists/party/server';

import {
  applicantStatus,
  type Application,
  type ApplicationSummary,
} from '../../contracts/index.ts';
import { definitionOf } from '../forms/read.ts';
import type { ApplicationDependencies } from './context.ts';
import type { Tx } from '../programme/tables.ts';
import { localAt } from '../programme/time.ts';
import { applicationsDb, type ApplicationsDb } from './tables.ts';

const summaryRows = (db: ApplicationsDb) =>
  db
    .selectFrom('grants.application as a')
    .innerJoin('grants.round as r', 'r.id', 'a.round_id')
    .innerJoin('grants.programme as p', 'p.id', 'r.programme_id')
    .select([
      'a.id',
      'a.status',
      'a.stage_id',
      'a.updated_at',
      'a.submitted_at',
      'a.round_id',
      'r.title as round_title',
      'r.closes_at',
      'r.timezone',
      'p.title as programme_title',
      'a.organisation_id',
    ]);

type SummaryRow = Awaited<ReturnType<ReturnType<typeof summaryRows>['execute']>>[number];

/** Each round's first stage, which a submitted application is in until it moves on. */
export async function firstStages(
  tx: Tx,
  roundIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  if (roundIds.length === 0) return new Map();
  const rows = await applicationsDb(tx)
    .selectFrom('grants.stage')
    .select(['round_id', 'id'])
    .distinctOn('round_id')
    .where('round_id', 'in', roundIds)
    .orderBy('round_id')
    .orderBy('position')
    .execute();
  return new Map(rows.map((row) => [row.round_id, row.id]));
}

/** Organisation names by id, read through party's contract. */
async function organisationNames(
  tx: Tx,
  ids: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const summaries = await organisationSummaries(tx, ids);
  return new Map(summaries.map(({ id, name }) => [id, name]));
}

function toSummary(
  row: SummaryRow,
  first: ReadonlyMap<string, string>,
  names: ReadonlyMap<string, string>,
): ApplicationSummary {
  return {
    id: row.id,
    round: {
      id: row.round_id,
      title: row.round_title,
      programmeTitle: row.programme_title,
      closesAt: localAt(row.timezone, row.closes_at),
      timeZone: row.timezone,
    },
    organisation: {
      id: row.organisation_id,
      name: names.get(row.organisation_id) ?? '',
    },
    status: applicantStatus({
      status: row.status,
      inFirstStage: row.stage_id !== null && row.stage_id === first.get(row.round_id),
      decision: null,
    }),
    updatedAt: row.updated_at.toISOString(),
    submittedAt: row.submitted_at?.toISOString() ?? null,
    outcome: null,
  };
}

/** The applicant's applications, the most recently changed first. */
export async function readApplications(tx: Tx, userId: string): Promise<ApplicationSummary[]> {
  const personId = await personIdForUser(tx, userId);
  if (personId === null) return [];
  const rows = await summaryRows(applicationsDb(tx))
    .where('a.applicant_person_id', '=', personId)
    .orderBy('a.updated_at', 'desc')
    .orderBy('a.id')
    .execute();
  const first = await firstStages(tx, [...new Set(rows.map((row) => row.round_id))]);
  const names = await organisationNames(tx, [...new Set(rows.map((row) => row.organisation_id))]);
  return rows.map((row) => toSummary(row, first, names));
}

/**
 * The answers as the engine checks them: those saved, with the ids of the
 * files linked to each file question, which the server adds from its own
 * table and a client never sends (ADR 0047).
 */
export async function answersWithFiles(
  tx: Tx,
  applicationId: string,
  saved: unknown,
): Promise<Answers> {
  const links = await applicationsDb(tx)
    .selectFrom('grants.application_file')
    .select(['field_id', 'file_id'])
    .where('application_id', '=', applicationId)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  const files = new Map<string, string[]>();
  for (const { field_id, file_id } of links) {
    files.set(field_id, [...(files.get(field_id) ?? []), file_id]);
  }
  return { ...(saved as Answers), ...Object.fromEntries(files) };
}

/** One of the applicant's applications, or undefined where it is not theirs. */
export async function readApplication(
  tx: Tx,
  userId: string,
  applicationId: string,
): Promise<Application | undefined> {
  const personId = await personIdForUser(tx, userId);
  if (personId === null) return undefined;
  const row = await summaryRows(applicationsDb(tx))
    .innerJoin('grants.form_version as f', 'f.id', 'a.form_version_id')
    .select(['a.answers', 'a.answers_version', 'a.withdrawn_at', 'f.id as form_id', 'f.definition'])
    .where('a.id', '=', applicationId)
    .where('a.applicant_person_id', '=', personId)
    .executeTakeFirst();
  const definition = definitionOf(row?.definition ?? null);
  if (row === undefined || definition === null) return undefined;

  const first = await firstStages(tx, [row.round_id]);
  const names = await organisationNames(tx, [row.organisation_id]);
  const answers = await answersWithFiles(tx, row.id, row.answers);
  return {
    ...toSummary(row, first, names),
    form: { id: row.form_id, definition },
    answers: projectedAnswers(definition, answers, 'applicant'),
    answersVersion: row.answers_version,
    eligibility: checkEligibility(definition, answers),
    withdrawnAt: row.withdrawn_at?.toISOString() ?? null,
  };
}

/** One of the applicant's applications, as a 404 where it is not theirs. */
export async function ownApplication(
  tx: Tx,
  deps: ApplicationDependencies,
  userId: string,
  applicationId: string,
): Promise<Application> {
  return (await readApplication(tx, userId, applicationId)) ?? Promise.reject(deps.notFound());
}
