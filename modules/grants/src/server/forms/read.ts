// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Reading form versions as the contracts answer them. Row-level security
// keeps every query inside the caller's tenant, so a round or version of
// another tenant is simply not there.

import type { FormDefinition } from '@pixel-scientists/domain/forms';
import { peopleByUserIds } from '@pixel-scientists/party/server';

import type { FormVersion, FormVersionStatus, FormVersionSummary } from '../../contracts/index.ts';
import type { Tx } from '../programme/tables.ts';
import { formsDb } from './tables.ts';

const summaryColumns = [
  'id',
  'round_id',
  'version',
  'status',
  'updated_at',
  'published_at',
  'published_by',
] as const;

/** A version as stored. The definition was saved as the form engine parsed it. */
export interface VersionRow {
  readonly id: string;
  readonly round_id: string;
  readonly version: number;
  readonly status: FormVersionStatus;
  readonly definition: unknown;
  readonly updated_at: Date;
  readonly published_at: Date | null;
  readonly published_by: string | null;
}

export const definitionOf = (stored: unknown): FormDefinition | null =>
  stored === null ? null : (stored as FormDefinition);

export async function roundExists(tx: Tx, roundId: string): Promise<boolean> {
  const round = await formsDb(tx)
    .selectFrom('grants.round')
    .select('id')
    .where('id', '=', roundId)
    .executeTakeFirst();
  return round !== undefined;
}

/** The version, locked for the rest of the request when asked. A published version cannot be locked. */
export function findVersion(tx: Tx, id: string, lock = false): Promise<VersionRow | undefined> {
  const query = formsDb(tx)
    .selectFrom('grants.form_version')
    .select([...summaryColumns, 'definition'])
    .where('id', '=', id);
  return (lock ? query.forUpdate() : query).executeTakeFirst();
}

/** The round's published definitions, the oldest first. */
export async function publishedDefinitions(tx: Tx, roundId: string): Promise<FormDefinition[]> {
  const rows = await formsDb(tx)
    .selectFrom('grants.form_version')
    .select('definition')
    .where('round_id', '=', roundId)
    .where('status', '=', 'published')
    .orderBy('version')
    .execute();
  return rows.flatMap(({ definition }) => definitionOf(definition) ?? []);
}

/** Who published each version, by name when their account has a person record. */
async function publisherNames(
  tx: Tx,
  rows: readonly Pick<VersionRow, 'published_by'>[],
): Promise<ReadonlyMap<string, string | null>> {
  const ids = [...new Set(rows.flatMap((row) => row.published_by ?? []))];
  if (ids.length === 0) return new Map();
  const members = await formsDb(tx)
    .selectFrom('app.membership')
    .select(['id', 'user_id'])
    .where('id', 'in', ids)
    .execute();
  const people = await peopleByUserIds(
    tx,
    members.map((member) => member.user_id),
  );
  return new Map(
    members.map(({ id, user_id }) => {
      const person = people.get(user_id);
      const name = [person?.givenName, person?.familyName].filter(Boolean).join(' ');
      return [id, name === '' ? null : name];
    }),
  );
}

function toSummary(
  row: Omit<VersionRow, 'definition'>,
  names: ReadonlyMap<string, string | null>,
): FormVersionSummary {
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    updatedAt: row.updated_at.toISOString(),
    publishedAt: row.published_at?.toISOString() ?? null,
    publishedBy:
      row.published_by === null
        ? null
        : { membershipId: row.published_by, name: names.get(row.published_by) ?? null },
  };
}

/** A round's versions, the newest first, without their definitions. */
export async function readVersions(tx: Tx, roundId: string): Promise<FormVersionSummary[]> {
  const rows = await formsDb(tx)
    .selectFrom('grants.form_version')
    .select(summaryColumns)
    .where('round_id', '=', roundId)
    .orderBy('version', 'desc')
    .execute();
  const names = await publisherNames(tx, rows);
  return rows.map((row) => toSummary(row, names));
}

/** The version with its definition, or undefined where there is none for the caller. */
export async function readVersion(tx: Tx, id: string): Promise<FormVersion | undefined> {
  const row = await findVersion(tx, id);
  if (row === undefined) return undefined;
  return {
    ...toSummary(row, await publisherNames(tx, [row])),
    roundId: row.round_id,
    definition: definitionOf(row.definition),
  };
}
