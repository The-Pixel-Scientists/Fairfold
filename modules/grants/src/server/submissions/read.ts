// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Reading submissions as the staff contracts answer them (ADR 0004). A
// submission is a submitted or withdrawn application: drafts are left out
// of every query here, so no filter or id reaches one. Row-level security
// keeps every query inside the caller's tenant. Answers are projected for
// staff from the pinned form version, so aggregate-only answers never leave
// this file. The filters name fields of the application and its round, and
// never an answer.

import type { ExpressionBuilder } from '@pixel-scientists/db';
import { projectedAnswers } from '@pixel-scientists/domain/api';
import type { PersonName } from '@pixel-scientists/party/contracts';
import {
  contactDetails,
  organisationSummaries,
  peopleByUserIds,
} from '@pixel-scientists/party/server';

import {
  submissionStatuses,
  type ApplicationStatus,
  type Submission,
  type SubmissionEvent,
  type SubmissionPage,
  type SubmissionQuery,
  type SubmissionSummary,
} from '../../contracts/index.ts';
import { answersWithFiles } from '../applications/read.ts';
import { definitionOf } from '../forms/read.ts';
import type { Tx } from '../programme/tables.ts';
import { decodeCursor, encodeCursor } from './cursor.ts';
import { submissionsDb, type SubmissionTables } from './tables.ts';

const PAGE_SIZE = 50;

const STATUSES = Object.keys(submissionStatuses) as [
  keyof typeof submissionStatuses,
  ...(keyof typeof submissionStatuses)[],
];

type Filters = Omit<SubmissionQuery, 'cursor'>;

/** Submissions with their round, programme and stage, narrowed by the filters. */
function matching(tx: Tx, filters: Filters) {
  let query = submissionsDb(tx)
    .selectFrom('grants.application as a')
    .innerJoin('grants.round as r', 'r.id', 'a.round_id')
    .innerJoin('grants.programme as p', 'p.id', 'r.programme_id')
    .innerJoin('grants.stage as s', 's.id', 'a.stage_id')
    .where('a.status', 'in', STATUSES);
  if (filters.programmeId !== undefined) query = query.where('p.id', '=', filters.programmeId);
  if (filters.roundId !== undefined) query = query.where('r.id', '=', filters.roundId);
  if (filters.stageId !== undefined) query = query.where('s.id', '=', filters.stageId);
  if (filters.status !== undefined) query = query.where('a.status', '=', filters.status);
  if (filters.late !== undefined) query = query.where('a.submitted_late', '=', filters.late);
  if (filters.eligibility !== undefined) {
    const outcome = filters.eligibility;
    query = query.where((eb) => eb(latestEligibility(eb), '=', outcome));
  }
  return query;
}

/** The outcome of an application's most recent eligibility check, null if it has none. */
function latestEligibility(
  eb: ExpressionBuilder<SubmissionTables & { a: SubmissionTables['grants.application'] }, 'a'>,
) {
  return eb
    .selectFrom('grants.eligibility_result as e')
    .select('e.outcome')
    .whereRef('e.application_id', '=', 'a.id')
    .orderBy('e.checked_at', 'desc')
    .orderBy('e.id', 'desc')
    .limit(1);
}

const summaryColumns = [
  'a.id',
  'a.status',
  'a.submitted_at',
  'a.submitted_late',
  'a.organisation_id',
  'r.id as round_id',
  'r.title as round_title',
  'p.id as programme_id',
  'p.title as programme_title',
  's.id as stage_id',
  's.name as stage_name',
] as const;

interface SummaryRow {
  readonly id: string;
  readonly status: ApplicationStatus;
  readonly submitted_at: Date;
  readonly submitted_late: boolean;
  readonly organisation_id: string;
  readonly round_id: string;
  readonly round_title: string;
  readonly programme_id: string;
  readonly programme_title: string;
  readonly stage_id: string;
  readonly stage_name: string;
  readonly eligibility: SubmissionSummary['eligibility'];
}

function toSummary(row: SummaryRow, organisationName: string): SubmissionSummary {
  return {
    id: row.id,
    programme: { id: row.programme_id, title: row.programme_title },
    round: { id: row.round_id, title: row.round_title },
    stage: { id: row.stage_id, name: row.stage_name },
    organisation: { id: row.organisation_id, name: organisationName },
    // The query admits only submitted and withdrawn applications.
    status: row.status as SubmissionSummary['status'],
    submittedAt: row.submitted_at.toISOString(),
    late: row.submitted_late,
    eligibility: row.eligibility,
  };
}

async function organisationNames(
  tx: Tx,
  ids: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const summaries = await organisationSummaries(tx, ids);
  return new Map(summaries.map(({ id, name }) => [id, name]));
}

/**
 * A page of submissions, the latest submitted first. Returns null if the
 * cursor does not name a submission in this tenant.
 */
export async function readSubmissions(
  tx: Tx,
  { cursor, ...filters }: SubmissionQuery,
): Promise<SubmissionPage | null> {
  let query = matching(tx, filters)
    .select(summaryColumns)
    .select((eb) => latestEligibility(eb).as('eligibility'))
    .orderBy('a.submitted_at', 'desc')
    .orderBy('a.id', 'desc')
    .limit(PAGE_SIZE + 1);

  if (cursor !== undefined) {
    const after = decodeCursor(cursor);
    const found =
      after === null
        ? undefined
        : await submissionsDb(tx)
            .selectFrom('grants.application')
            .select('id')
            .where('id', '=', after)
            .where('status', 'in', STATUSES)
            .executeTakeFirst();
    if (found === undefined) return null;
    query = query.where((eb) => {
      const submittedAt = eb
        .selectFrom('grants.application as c')
        .select('c.submitted_at')
        .where('c.id', '=', found.id);
      return eb.or([
        eb('a.submitted_at', '<', submittedAt),
        eb.and([eb('a.submitted_at', '=', submittedAt), eb('a.id', '<', found.id)]),
      ]);
    });
  }

  const rows = await query.execute();
  const { total } = await matching(tx, filters)
    .select((eb) => eb.fn.countAll<string>().as('total'))
    .executeTakeFirstOrThrow();
  const page = rows.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  const names = await organisationNames(tx, [...new Set(page.map((row) => row.organisation_id))]);
  return {
    submissions: page.map((row) => toSummary(row, names.get(row.organisation_id) ?? '')),
    total: Number(total),
    nextCursor: rows.length > PAGE_SIZE && last !== undefined ? encodeCursor(last.id) : null,
  };
}

const fullName = (person: { givenName: string | null; familyName: string | null } | undefined) => {
  const name = [person?.givenName, person?.familyName].filter(Boolean).join(' ');
  return name === '' ? null : name;
};

/** Each membership's holder by name, when their account has a person record. */
async function peopleByMembership(
  tx: Tx,
  membershipIds: readonly string[],
): Promise<ReadonlyMap<string, PersonName | undefined>> {
  const ids = [...new Set(membershipIds)];
  if (ids.length === 0) return new Map();
  const members = await submissionsDb(tx)
    .selectFrom('app.membership')
    .select(['id', 'user_id'])
    .where('id', 'in', ids)
    .execute();
  const people = await peopleByUserIds(
    tx,
    members.map((member) => member.user_id),
  );
  return new Map(members.map((member) => [member.id, people.get(member.user_id)] as const));
}

/** One submission, or undefined where there is none, a draft's id included. */
export async function readSubmission(tx: Tx, id: string): Promise<Submission | undefined> {
  const db = submissionsDb(tx);
  const row = await matching(tx, {})
    .innerJoin('grants.form_version as f', 'f.id', 'a.form_version_id')
    .select([
      ...summaryColumns,
      'a.answers',
      'a.applicant_person_id',
      'a.created_by',
      'a.updated_by',
      'a.withdrawn_at',
      'f.id as form_id',
      'f.version as form_version',
      'f.definition',
    ])
    .select((eb) => latestEligibility(eb).as('eligibility'))
    .where('a.id', '=', id)
    .executeTakeFirst();
  const definition = definitionOf(row?.definition ?? null);
  if (row === undefined || definition === null) return undefined;

  const [organisation] = await organisationSummaries(tx, [row.organisation_id]);
  if (organisation === undefined) return undefined;

  const checks = await db
    .selectFrom('grants.eligibility_result')
    .select(['outcome', 'stopping_field_id', 'checked_at'])
    .where('application_id', '=', id)
    .orderBy('checked_at', 'desc')
    .orderBy('id', 'desc')
    .execute();
  const moves = await db
    .selectFrom('grants.stage_transition as x')
    .leftJoin('grants.stage as f', 'f.id', 'x.from_stage_id')
    .innerJoin('grants.stage as t', 't.id', 'x.to_stage_id')
    .select([
      'x.moved_at',
      'x.moved_by',
      'f.id as from_id',
      'f.name as from_name',
      't.id as to_id',
      't.name as to_name',
    ])
    .where('x.application_id', '=', id)
    .orderBy('x.moved_at')
    .orderBy('x.id')
    .execute();

  // The applicant made the application and submitted it, and only they can withdraw it.
  const people = await peopleByMembership(tx, [
    ...(row.created_by === null ? [] : [row.created_by]),
    ...(row.updated_by === null ? [] : [row.updated_by]),
    ...moves.map((move) => move.moved_by),
  ]);
  const nameOf = (membershipId: string | null) =>
    fullName(membershipId === null ? undefined : people.get(membershipId));
  const applicant = row.created_by === null ? undefined : people.get(row.created_by);
  const details = await contactDetails(tx, row.applicant_person_id);
  if (details === null) return undefined;

  // Order is the order things happened: a withdrawn application never moves again.
  const history: SubmissionEvent[] = [
    { event: 'submitted', at: row.submitted_at.toISOString(), by: nameOf(row.created_by) },
    ...moves.map((move) => ({
      event: 'stage_changed' as const,
      at: move.moved_at.toISOString(),
      by: nameOf(move.moved_by),
      from: move.from_id === null ? null : { id: move.from_id, name: move.from_name ?? '' },
      to: { id: move.to_id, name: move.to_name },
    })),
    ...(row.withdrawn_at === null
      ? []
      : [
          {
            event: 'withdrawn' as const,
            at: row.withdrawn_at.toISOString(),
            by: nameOf(row.updated_by),
          },
        ]),
  ];

  return {
    ...toSummary(row, organisation.name),
    form: { id: row.form_id, version: row.form_version, definition },
    answers: projectedAnswers(definition, await answersWithFiles(tx, id, row.answers), 'staff'),
    organisation,
    contact: {
      personId: row.applicant_person_id,
      givenName: details.givenName,
      // Party's contact details have no family name, so it is read from the applicant's own account.
      familyName:
        applicant?.personId === row.applicant_person_id ? (applicant.familyName ?? null) : null,
      email: details.email,
    },
    withdrawnAt: row.withdrawn_at?.toISOString() ?? null,
    eligibilityChecks: checks.map((check) => ({
      outcome: check.outcome,
      fieldId: check.stopping_field_id,
      checkedAt: check.checked_at.toISOString(),
    })),
    history,
  };
}
