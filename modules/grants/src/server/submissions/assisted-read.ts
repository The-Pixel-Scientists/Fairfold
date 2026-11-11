// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Reading the applications staff started for an applicant on the alternative
// route, as the console contracts answer them. Only applications whose route
// is `assisted` are read here, so an applicant's own draft never reaches
// the console. Answers are projected for staff from the pinned form version.

import { projectedAnswers } from '@pixel-scientists/domain/api';
import { checkEligibility } from '@pixel-scientists/domain/forms';
import { contactDetails, organisationSummaries } from '@pixel-scientists/party/server';

import type { AssistedApplication, AssistedList } from '../../contracts/index.ts';
import { closingTime } from '../applications/closing.ts';
import { answersWithFiles } from '../applications/read.ts';
import { applicationsDb } from '../applications/tables.ts';
import { definitionOf } from '../forms/read.ts';
import type { Tx } from '../programme/tables.ts';
import { localAt } from '../programme/time.ts';

const assisted = (tx: Tx) =>
  applicationsDb(tx)
    .selectFrom('grants.application as a')
    .where('a.submission_route', '=', 'assisted');

type Summary = AssistedList['applications'][number];

/** The organisations' and contacts' names, which a summary carries. */
async function summaries(
  tx: Tx,
  rows: readonly {
    id: string;
    organisation_id: string;
    applicant_person_id: string;
    updated_at: Date;
  }[],
): Promise<Summary[]> {
  const organisations = new Map(
    (await organisationSummaries(tx, [...new Set(rows.map((row) => row.organisation_id))])).map(
      ({ id, name }) => [id, name],
    ),
  );
  const people = new Map<string, string | null>();
  for (const { applicant_person_id } of rows) {
    if (!people.has(applicant_person_id)) {
      people.set(
        applicant_person_id,
        (await contactDetails(tx, applicant_person_id))?.givenName ?? null,
      );
    }
  }
  return rows.map((row) => ({
    id: row.id,
    organisation: { id: row.organisation_id, name: organisations.get(row.organisation_id) ?? '' },
    contact: {
      personId: row.applicant_person_id,
      name: people.get(row.applicant_person_id) ?? null,
    },
    updatedAt: row.updated_at.toISOString(),
  }));
}

/** A round's assisted drafts, the most recently changed first. */
export async function readAssistedList(tx: Tx, roundId: string): Promise<AssistedList> {
  const rows = await assisted(tx)
    .select(['a.id', 'a.organisation_id', 'a.applicant_person_id', 'a.updated_at'])
    .where('a.round_id', '=', roundId)
    .where('a.status', '=', 'draft')
    .orderBy('a.updated_at', 'desc')
    .orderBy('a.id')
    .execute();
  return { applications: await summaries(tx, rows) };
}

/** One assisted application, or undefined where there is none. */
export async function readAssisted(
  tx: Tx,
  applicationId: string,
): Promise<AssistedApplication | undefined> {
  const row = await assisted(tx)
    .innerJoin('grants.round as r', 'r.id', 'a.round_id')
    .innerJoin('grants.form_version as f', 'f.id', 'a.form_version_id')
    .select([
      'a.id',
      'a.organisation_id',
      'a.applicant_person_id',
      'a.updated_at',
      'a.round_id',
      'a.answers',
      'a.answers_version',
      'r.title as round_title',
      'r.timezone',
      'f.id as form_id',
      'f.definition',
    ])
    .where('a.id', '=', applicationId)
    .executeTakeFirst();
  const definition = definitionOf(row?.definition ?? null);
  if (row === undefined || definition === null) return undefined;

  const [summary] = await summaries(tx, [row]);
  const { closesAt } = await closingTime(tx, {
    roundId: row.round_id,
    organisationId: row.organisation_id,
    applicationId,
  });
  const answers = await answersWithFiles(tx, applicationId, row.answers);
  return summary === undefined
    ? undefined
    : {
        ...summary,
        round: { id: row.round_id, title: row.round_title },
        closesAt: localAt(row.timezone, closesAt),
        timeZone: row.timezone,
        form: { id: row.form_id, definition },
        answers: projectedAnswers(definition, answers, 'staff'),
        answersVersion: row.answers_version,
        eligibility: checkEligibility(definition, answers),
      };
}
