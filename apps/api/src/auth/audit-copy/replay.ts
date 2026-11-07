// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The audit-copy replay (ADR 0010, "Audit"). It takes the oldest pending
// copies' ids once, at the start, so it never chases rows written during
// the run, and handles each event on its own:
//
//   1. write the copy in the event's recorded tenant, as app_api, or find it
//      already there (recorded-tenant.ts);
//   2. then, as app_auth, delete the pending row and, where a copy now
//      exists, record audit_copy_replayed with the event's id and tenant;
//   3. then copy audit_copy_replayed to that tenant's log, by the operator,
//      as the live path copies an event: if that fails, its pending row
//      stays and the next run writes it, recording no further replay.
//
// A crash between 1 and 2 leaves the pending row, and the next run finds
// the copy and only records and deletes. One event's failure is counted
// under a fixed reason and leaves its pending row; the run goes on.

import type { Kysely } from '@pixel-scientists/db';

import { copyIsDue, recordAuthEvent, type AuthEvent, type CopyOutcome } from '../events.ts';
import type { AuthTables } from '../tables.ts';
import {
  copyInRecordedTenant,
  readRecordedEvent,
  writeInRecordedTenant,
} from './recorded-tenant.ts';

export const MAX_LIMIT = 5000;

export const outcomes = [
  'copied',
  'found',
  'cleared',
  'due',
  'failed_constraint',
  'failed_connection',
  'failed_other',
] as const;
export type Outcome = (typeof outcomes)[number];
export type ReplayCounts = Record<Outcome, number>;

export interface ReplayDependencies {
  /** As app_api. */
  readonly api: Kysely<unknown>;
  /** As app_auth. */
  readonly auth: Kysely<unknown>;
}

export interface ReplayOptions {
  /** How many pending copies to take, from 1 to MAX_LIMIT. */
  readonly limit: number;
  /** Count what is due and write nothing. */
  readonly dryRun: boolean;
  /** The run's request id, on every audit_copy_replayed event. */
  readonly requestId: string;
}

/** A fixed reason for a failure: never the database's message or constraint name. */
function failureOf(error: unknown): Outcome {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code !== 'string') return 'failed_other';
  if (code.startsWith('23')) return 'failed_constraint';
  if (/^(?:08|53|57)/.test(code) || code.startsWith('E')) return 'failed_connection';
  return 'failed_other';
}

/** The outcome for an event with no replay of its own to record. */
function settled(outcome: CopyOutcome, ours: boolean): Outcome {
  if (outcome === 'copied') return 'copied';
  return ours && outcome === 'none' ? 'cleared' : 'found';
}

/** Copy the run's own event, or leave its pending row for the next run. */
async function copyReplayEvent(deps: ReplayDependencies, event: AuthEvent): Promise<void> {
  try {
    await writeInRecordedTenant(deps.api, event);
    await deps.auth
      .$extendTables<AuthTables>()
      .deleteFrom('auth.audit_copy_pending')
      .where('auth_event_id', '=', event.id)
      .execute();
  } catch {
    // The pending row stays, and the oldest-copy metric shows its age.
  }
}

async function replayOne(
  deps: ReplayDependencies,
  id: string,
  options: ReplayOptions,
): Promise<Outcome> {
  if (options.dryRun) {
    return copyIsDue(await readRecordedEvent(deps.auth, id)) ? 'due' : 'cleared';
  }
  const { event, outcome } = await copyInRecordedTenant(deps, id);
  type Done = { readonly outcome: Outcome; readonly replayed?: AuthEvent };
  const done = await deps.auth.transaction().execute(async (trx): Promise<Done> => {
    const removed = await trx
      .$extendTables<AuthTables>()
      .deleteFrom('auth.audit_copy_pending')
      .where('auth_event_id', '=', id)
      .executeTakeFirst();
    // With no row left, the live path finished first and its copy stands.
    const ours = removed.numDeletedRows > 0n;
    if (
      event.tenant === undefined ||
      event.code === 'audit_copy_replayed' ||
      outcome === 'none' ||
      (outcome === 'exists' && !ours)
    ) {
      return { outcome: settled(outcome, ours) };
    }
    const replayed = await recordAuthEvent(trx, 'audit_copy_replayed', {
      requestId: options.requestId,
      tenant: event.tenant,
      replayedEventId: event.id,
    });
    return { outcome: outcome === 'copied' ? 'copied' : 'found', replayed };
  });
  if (done.replayed !== undefined) await copyReplayEvent(deps, done.replayed);
  return done.outcome;
}

/** Replay up to `options.limit` pending copies, oldest first, and count each outcome. */
export async function replayAuthCopies(
  deps: ReplayDependencies,
  options: ReplayOptions,
): Promise<ReplayCounts> {
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > MAX_LIMIT) {
    throw new RangeError(`The batch limit must be from 1 to ${String(MAX_LIMIT)}.`);
  }
  const counts = Object.fromEntries(outcomes.map((outcome) => [outcome, 0])) as ReplayCounts;
  const pending = await deps.auth
    .$extendTables<AuthTables>()
    .selectFrom('auth.audit_copy_pending')
    .select('auth_event_id')
    .orderBy('created_at')
    .orderBy('auth_event_id')
    .limit(options.limit)
    .execute();
  for (const { auth_event_id: id } of pending) {
    try {
      counts[await replayOne(deps, id, options)] += 1;
    } catch (error) {
      counts[failureOf(error)] += 1;
    }
  }
  return counts;
}
