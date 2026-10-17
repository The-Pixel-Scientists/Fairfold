// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The configuration history routes' handlers: an object's saved versions,
// newest first, each with its author named from their person record when
// they have one (party's contract). Names stay inside the tenant's staff.

import { peopleByUserIds } from '@pixel-scientists/party/server';

import {
  configVersionDiffSchema,
  type ConfigHistory,
  type GrantsConfigEntityType,
} from '../../contracts/index.ts';
import type { Args, GrantsDependencies } from './context.ts';
import { programmeExists, readRound } from './read.ts';
import type { Tx } from './tables.ts';

export function historyHandlers(deps: GrantsDependencies) {
  async function history(
    tx: Tx,
    entityType: GrantsConfigEntityType,
    entityId: string,
  ): Promise<ConfigHistory> {
    const rows = await deps.configHistory(tx, entityType, entityId);
    const people = await peopleByUserIds(
      tx,
      rows.map((row) => row.authorUserId),
    );
    return {
      versions: rows.map((row) => {
        const person = people.get(row.authorUserId);
        const name = [person?.givenName, person?.familyName].filter(Boolean).join(' ');
        return {
          version: row.version,
          createdAt: row.createdAt.toISOString(),
          author: { membershipId: row.authorId, name: name === '' ? null : name },
          ...configVersionDiffSchema.parse(row.diff),
        };
      }),
    };
  }

  async function getProgrammeHistory({
    tx,
    input,
  }: Args<{ params: { programmeId: string } }>): Promise<ConfigHistory> {
    const { programmeId } = input.params;
    if (!(await programmeExists(tx, programmeId))) throw deps.notFound();
    return history(tx, 'grants.programme', programmeId);
  }

  async function getRoundHistory({
    tx,
    input,
  }: Args<{ params: { roundId: string } }>): Promise<ConfigHistory> {
    const { roundId } = input.params;
    if ((await readRound(tx, roundId)) === undefined) throw deps.notFound();
    return history(tx, 'grants.round', roundId);
  }

  return { getProgrammeHistory, getRoundHistory };
}
