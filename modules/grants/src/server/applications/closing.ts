// SPDX-License-Identifier: AGPL-3.0-or-later
//
// When an application closes, by the database's clock: the only place this
// module reads a round's closing time to decide anything. The rule is the
// contract's effectiveClosingTime(), so the open_round scope, starting,
// submitting and the lateness flag cannot disagree.

import { effectiveClosingTime, type AdjustmentTiming } from '../../contracts/index.ts';
import type { Tx } from '../programme/tables.ts';
import { applicationsDb } from './tables.ts';

/** An application, or one about to start (with no id), whose closing time is wanted. */
export interface ClosingTarget {
  readonly roundId: string;
  readonly organisationId: string;
  readonly applicationId: string | null;
}

export interface Closing {
  readonly closesAt: Date;
  /** Whether the database's clock is at or past `closesAt`. */
  readonly closed: boolean;
}

/** The database's clock, which every closing decision reads. */
export async function databaseNow(tx: Tx): Promise<Date> {
  const { now } = await applicationsDb(tx)
    .selectNoFrom((eb) => eb.fn<Date>('now', []).as('now'))
    .executeTakeFirstOrThrow();
  return now;
}

/** The deadline extensions of these rounds, as the rule reads them. */
async function extensionsOf(tx: Tx, roundIds: readonly string[]): Promise<AdjustmentTiming[]> {
  const rows = await applicationsDb(tx)
    .selectFrom('grants.adjustment')
    .select(['round_id', 'organisation_id', 'application_id', 'kind', 'closes_at', 'revoked_at'])
    .where('round_id', 'in', roundIds)
    .where('kind', '=', 'deadline_extension')
    .execute();
  return rows.map((row) => ({
    roundId: row.round_id,
    organisationId: row.organisation_id,
    applicationId: row.application_id,
    kind: row.kind,
    closesAt: row.closes_at,
    revoked: row.revoked_at !== null,
  }));
}

/** Each item with its closing time, in the order given. An item's round must exist. */
export async function withClosing<T>(
  tx: Tx,
  items: readonly T[],
  targetOf: (item: T) => ClosingTarget,
): Promise<{ item: T; closing: Closing }[]> {
  if (items.length === 0) return [];
  const roundIds = [...new Set(items.map((item) => targetOf(item).roundId))];
  const db = applicationsDb(tx);
  const rounds = await db
    .selectFrom('grants.round')
    .select(['id', 'closes_at'])
    .where('id', 'in', roundIds)
    .execute();
  const ownClosing = new Map(rounds.map((round) => [round.id, round.closes_at]));
  const extensions = await extensionsOf(tx, roundIds);
  const now = await databaseNow(tx);
  return items.map((item) => {
    const target = targetOf(item);
    const roundClosesAt = ownClosing.get(target.roundId);
    if (roundClosesAt === undefined) throw new Error('The round of a closing target is missing.');
    const closesAt = effectiveClosingTime(
      {
        roundId: target.roundId,
        organisationId: target.organisationId,
        id: target.applicationId,
        roundClosesAt,
      },
      extensions,
      now,
    );
    return { item, closing: { closesAt, closed: now >= closesAt } };
  });
}

export async function closingTime(tx: Tx, target: ClosingTarget): Promise<Closing> {
  const [found] = await withClosing(tx, [target], (item) => item);
  return found?.closing ?? Promise.reject(new Error('The closing time was not worked out.'));
}
