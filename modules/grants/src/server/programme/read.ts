// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Reading programme set-up rows as the contracts answer them. Row-level
// security keeps every query inside the caller's tenant, so a row of another
// tenant is simply not there.

import {
  defaultEmailTemplates,
  type Criterion,
  type EmailTemplates,
  type Outcome,
  type Round,
  type Stage,
} from '../../contracts/index.ts';
import { grantsDb, type GrantsDb, type Tx } from './tables.ts';
import { localAt } from './time.ts';

const selectRounds = (db: GrantsDb) =>
  db
    .selectFrom('grants.round')
    .select([
      'id',
      'programme_id',
      'title',
      'opens_at',
      'closes_at',
      'timezone',
      'currency',
      'budget_minor',
      'award_min_minor',
      'award_max_minor',
      'late_policy',
    ]);

type RoundRow = Awaited<ReturnType<ReturnType<typeof selectRounds>['execute']>>[number];

const money = (amountMinor: string, currency: 'GBP') => ({
  amountMinor: Number(amountMinor),
  currency,
});

/** The round with its times as the wall clock of the zone it was saved in. */
export function toRound(row: RoundRow): Round {
  return {
    id: row.id,
    programmeId: row.programme_id,
    title: row.title,
    opensAt: localAt(row.timezone, row.opens_at),
    closesAt: localAt(row.timezone, row.closes_at),
    timeZone: row.timezone,
    budget: money(row.budget_minor, row.currency),
    awardMinimum: money(row.award_min_minor, row.currency),
    awardMaximum: money(row.award_max_minor, row.currency),
    latePolicy: row.late_policy,
  };
}

/** The rounds of one programme, or of every programme, the latest opening first. */
export async function readRounds(tx: Tx, programmeId?: string): Promise<Round[]> {
  const query = selectRounds(grantsDb(tx)).orderBy('opens_at', 'desc').orderBy('id');
  const rows = await (
    programmeId === undefined ? query : query.where('programme_id', '=', programmeId)
  ).execute();
  return rows.map(toRound);
}

/** Whether the programme is there for the caller, locked for the rest of the request when asked. */
export async function programmeExists(tx: Tx, programmeId: string, lock = false): Promise<boolean> {
  const query = grantsDb(tx)
    .selectFrom('grants.programme')
    .select('id')
    .where('id', '=', programmeId);
  return (await (lock ? query.forUpdate() : query).executeTakeFirst()) !== undefined;
}

export async function readRound(tx: Tx, roundId: string, lock = false): Promise<Round | undefined> {
  const query = selectRounds(grantsDb(tx)).where('id', '=', roundId);
  const row = await (lock ? query.forUpdate() : query).executeTakeFirst();
  return row === undefined ? undefined : toRound(row);
}

/** A round's stages in order, each with its criteria in order. */
export async function readStages(tx: Tx, roundId: string): Promise<Stage[]> {
  const db = grantsDb(tx);
  const stages = await db
    .selectFrom('grants.stage')
    .select(['id', 'name', 'position'])
    .where('round_id', '=', roundId)
    .orderBy('position')
    .execute();
  const criteria = await readCriteria(
    tx,
    stages.map((stage) => stage.id),
  );
  return stages.map((stage) => ({ ...stage, criteria: criteria.get(stage.id) ?? [] }));
}

/** The criteria of the stages, in order, by stage. */
export async function readCriteria(
  tx: Tx,
  stageIds: readonly string[],
): Promise<Map<string, Criterion[]>> {
  const byStage = new Map<string, Criterion[]>();
  if (stageIds.length === 0) return byStage;
  const rows = await grantsDb(tx)
    .selectFrom('grants.rubric_criterion')
    .select(['id', 'stage_id', 'label', 'guidance', 'weight', 'scale_min', 'scale_max'])
    .where('stage_id', 'in', stageIds)
    .orderBy('position')
    .execute();
  for (const { stage_id, scale_min, scale_max, ...criterion } of rows) {
    byStage.set(stage_id, [
      ...(byStage.get(stage_id) ?? []),
      { ...criterion, scaleMin: scale_min, scaleMax: scale_max },
    ]);
  }
  return byStage;
}

/**
 * The latest version of each outcome's template. A programme that has none
 * yet reads as the defaults at version 0, and its first save is version 1.
 */
export async function readTemplates(tx: Tx, programmeId: string): Promise<EmailTemplates> {
  const rows = await grantsDb(tx)
    .selectFrom('grants.email_template_version')
    .select(['outcome', 'subject', 'body', 'version'])
    .distinctOn('outcome')
    .where('programme_id', '=', programmeId)
    .orderBy('outcome')
    .orderBy('version', 'desc')
    .execute();
  const latest = new Map(rows.map(({ outcome, ...template }) => [outcome, template]));
  const template = (outcome: Outcome) =>
    latest.get(outcome) ?? { ...defaultEmailTemplates[outcome], version: 0 };
  return {
    accepted: template('accepted'),
    waitlisted: template('waitlisted'),
    declined: template('declined'),
  };
}
