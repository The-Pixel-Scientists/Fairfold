// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The grants side of a party merge (ADR 0025). In the merge transaction,
// grants moves the columns below from the loser to the survivor, or refuses
// with a conflict below. A merge corrects who a record is about, never an
// outcome: nothing here changes a status, outcome or amount (rule 9), and
// nothing is resent. The implementation is the server's (party-repoint.ts).
//
// Precondition, a migration before S12-31: app_api gains UPDATE
// on the three party-key columns of migrations 0011 and 0013, a withdrawn
// application lets an update of only its party keys through, and a
// decision_email update of only recipient_person_id passes without counting
// a send attempt or touching status, sent_at or last_attempt_at. Until then
// the schema refuses to move a withdrawn application or any decision email.

import type { MergeConflict, PartyKind, RepointParty } from '@pixel-scientists/party/contracts';
import { z } from 'zod';

interface PartyKey {
  readonly table: `grants.${string}`;
  readonly column: string;
  readonly kind: PartyKind;
  /** The task whose migration adds the column, while the schema does not have it yet. */
  readonly plannedIn?: string;
}

/** Every grants column holding a party key. A new one is added here on purpose, as the test forces. */
export const grantsPartyKeys = [
  { table: 'grants.application', column: 'applicant_person_id', kind: 'person' },
  { table: 'grants.application', column: 'organisation_id', kind: 'organisation' },
  { table: 'grants.decision_email', column: 'recipient_person_id', kind: 'person' },
  {
    table: 'grants.adjustment',
    column: 'organisation_id',
    kind: 'organisation',
    plannedIn: 'S12-09',
  },
  {
    table: 'grants.message_notification',
    column: 'recipient_person_id',
    kind: 'person',
    plannedIn: 'S12-13',
  },
  {
    table: 'grants.reminder_email',
    column: 'recipient_person_id',
    kind: 'person',
    plannedIn: 'S12-21',
  },
] as const satisfies readonly PartyKey[];

/** Columns that name a party record but are never re-pointed, each with why. */
export const grantsPartyKeysExcluded = [
  {
    table: 'grants.application',
    column: 'organisation_snapshot_id',
    reason: 'The organisation details as submitted never move (ADR 0017).',
  },
] as const;

export type GrantsRepointTable = (typeof grantsPartyKeys)[number]['table'];

export const grantsRepointTables = [
  ...new Set(grantsPartyKeys.map(({ table }) => table)),
] as GrantsRepointTable[];

const count = z.int().nonnegative();

/** Rows grants re-pointed in each of its tables; a table it changed no row in is left out. */
export const grantsRepointCountsSchema = z.strictObject(
  Object.fromEntries(grantsRepointTables.map((table) => [table, count.optional()])) as Record<
    GrantsRepointTable,
    z.ZodOptional<typeof count>
  >,
);

export type GrantsRepointCounts = z.infer<typeof grantsRepointCountsSchema>;

/** Why grants refuses an organisation merge, each from party's closed list. */
export const grantsRepointConflicts = {
  /**
   * The loser and the survivor each hold a live application in the same
   * round, which would break one live application per organisation per round.
   */
  liveApplicationInRound: 'module_refused',
  /**
   * The loser has an application holding an organisation snapshot. The
   * snapshot never changes and names the loser, and the application's
   * foreign key ties its organisation to the snapshot's (migration 0019),
   * so the application cannot move. Decided: refuse until Aaron chooses
   * whether a migration loosens that key, as ADR 0025 assumes; that
   * migration then removes this entry and its test on purpose.
   */
  submittedApplicationSnapshot: 'module_refused',
} as const satisfies Record<string, MergeConflict>;

/** What the grants server registers with party's merge executor: ids and kind in, no tenant. */
export type GrantsRepoint<Tx> = RepointParty<Tx> & { readonly module: 'grants' };
