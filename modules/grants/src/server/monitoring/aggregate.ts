// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Equality monitoring counts for the insight module (ADR 0032), called in the
// caller's own tenant transaction. It reads only responses of rounds that
// have closed for monitoring, counts the answers to questions with fixed
// options, and returns totals: no application, person, party or response id,
// and never free text. Nothing is logged, cached or stored. Suppressing small
// numbers is the caller's job. A tenant with grants switched off gets a fixed
// answer and no row is read (ADR 0024).

import { questionsOf } from '@pixel-scientists/domain/forms';
import type { FormDefinition } from '@pixel-scientists/domain/forms';

import { monitoringClosingTime, type AdjustmentTiming } from '../../contracts/index.ts';
import type { Tx } from '../programme/tables.ts';
import { monitoringDb } from './tables.ts';

export interface OptionCount {
  readonly value: string;
  readonly count: number;
}

export interface QuestionCounts {
  readonly fieldId: string;
  readonly options: readonly OptionCount[];
}

/** One round closed for monitoring: how many responses it has, and each question's counts. */
export interface RoundCounts {
  readonly roundId: string;
  readonly responses: number;
  readonly questions: readonly QuestionCounts[];
}

export type MonitoringCounts =
  | { readonly status: 'grants_off' }
  | { readonly status: 'counted'; readonly rounds: readonly RoundCounts[] };

/** Questions whose answers are a choice from a fixed list. */
const CHOICES: ReadonlySet<string> = new Set(['single_choice', 'dropdown', 'multiple_choice']);

/** Counts the answers of a round's responses, each against the form version it was given for. */
function countRound(
  roundId: string,
  responses: readonly { answers: unknown; definition: FormDefinition }[],
): RoundCounts {
  const counts = new Map<string, Map<string, number>>();
  for (const { answers, definition } of responses) {
    for (const field of questionsOf(definition)) {
      if (!CHOICES.has(field.type) || !('options' in field)) continue;
      const question = counts.get(field.id) ?? new Map<string, number>();
      counts.set(field.id, question);
      for (const { value } of field.options) question.set(value, question.get(value) ?? 0);
      const answer = (answers as Record<string, unknown>)[field.id];
      for (const chosen of Array.isArray(answer) ? answer : [answer]) {
        if (typeof chosen === 'string' && question.has(chosen)) {
          question.set(chosen, (question.get(chosen) ?? 0) + 1);
        }
      }
    }
  }
  return {
    roundId,
    responses: responses.length,
    questions: [...counts]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([fieldId, options]) => ({
        fieldId,
        options: [...options].map(([value, count]) => ({ value, count })),
      })),
  };
}

export async function monitoringCounts(
  tx: Tx,
  roundIds: readonly string[],
): Promise<MonitoringCounts> {
  const db = monitoringDb(tx);
  const grants = await db
    .selectFrom('app.tenant_module')
    .select('enabled')
    .where('module', '=', 'grants')
    .executeTakeFirst();
  if (grants?.enabled !== true) return { status: 'grants_off' };
  if (roundIds.length === 0) return { status: 'counted', rounds: [] };

  const rounds = await db
    .selectFrom('grants.round')
    .select(['id', 'closes_at'])
    .where('id', 'in', roundIds)
    .execute();
  const extensions = await db
    .selectFrom('grants.adjustment')
    .select(['round_id', 'organisation_id', 'application_id', 'kind', 'closes_at', 'revoked_at'])
    .where('round_id', 'in', roundIds)
    .where('kind', '=', 'deadline_extension')
    .execute();
  const timings: AdjustmentTiming[] = extensions.map((row) => ({
    roundId: row.round_id,
    organisationId: row.organisation_id,
    applicationId: row.application_id,
    kind: row.kind,
    closesAt: row.closes_at,
    revoked: row.revoked_at !== null,
  }));
  const { now } = await db
    .selectNoFrom((eb) => eb.fn<Date>('now', []).as('now'))
    .executeTakeFirstOrThrow();
  // Only rounds closed for monitoring, so no figure moves while answers can still change.
  const closed = rounds
    .filter(
      ({ id, closes_at }) => now >= monitoringClosingTime({ id, closesAt: closes_at }, timings),
    )
    .map(({ id }) => id);
  if (closed.length === 0) return { status: 'counted', rounds: [] };

  const responses = await db
    .selectFrom('grants.monitoring_response as m')
    .innerJoin('grants.form_version as f', 'f.id', 'm.form_version_id')
    .select(['m.round_id', 'm.answers', 'f.definition'])
    .where('m.round_id', 'in', closed)
    .execute();
  return {
    status: 'counted',
    rounds: [...closed].sort().map((roundId) =>
      countRound(
        roundId,
        responses
          .filter((row) => row.round_id === roundId)
          .map((row) => ({ answers: row.answers, definition: row.definition as FormDefinition })),
      ),
    ),
  };
}
