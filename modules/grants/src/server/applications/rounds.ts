// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Rounds taking applications, as the portal reads them. A round is open when
// its programme is open, its opening time has passed and its closing time has
// not, by the database's clock, and it has a published form. Everything else
// is not there for an applicant.

import type { FormDefinition } from '@pixel-scientists/domain/forms';

import type { OpenRound, OpenRoundDetail } from '../../contracts/index.ts';
import { definitionOf } from '../forms/read.ts';
import type { Tx } from '../programme/tables.ts';
import { localAt } from '../programme/time.ts';
import { applicationsDb, type ApplicationsDb } from './tables.ts';

const openRounds = (db: ApplicationsDb) =>
  db
    .selectFrom('grants.round as r')
    .innerJoin('grants.programme as p', 'p.id', 'r.programme_id')
    .where('p.status', '=', 'open')
    .where((eb) =>
      eb.and([
        eb('r.opens_at', '<=', eb.fn<Date>('now', [])),
        eb('r.closes_at', '>', eb.fn<Date>('now', [])),
        eb.exists(
          eb
            .selectFrom('grants.form_version as f')
            .select('f.id')
            .whereRef('f.round_id', '=', 'r.id')
            .where('f.status', '=', 'published'),
        ),
      ]),
    );

export async function isOpenRound(tx: Tx, roundId: string): Promise<boolean> {
  const row = await openRounds(applicationsDb(tx))
    .select('r.id')
    .where('r.id', '=', roundId)
    .executeTakeFirst();
  return row !== undefined;
}

const roundColumns = [
  'r.id',
  'r.title',
  'r.closes_at',
  'r.timezone',
  'r.award_min_minor',
  'r.award_max_minor',
  'p.id as programme_id',
  'p.title as programme_title',
  'p.summary as programme_summary',
] as const;

type Row = {
  id: string;
  title: string;
  closes_at: Date;
  timezone: string;
  award_min_minor: string;
  award_max_minor: string;
  programme_id: string;
  programme_title: string;
  programme_summary: string;
};

const money = (amountMinor: string) =>
  ({ amountMinor: Number(amountMinor), currency: 'GBP' }) as const;

const toOpenRound = (row: Row): OpenRound => ({
  id: row.id,
  title: row.title,
  programme: { id: row.programme_id, title: row.programme_title, summary: row.programme_summary },
  closesAt: localAt(row.timezone, row.closes_at),
  timeZone: row.timezone,
  awardMinimum: money(row.award_min_minor),
  awardMaximum: money(row.award_max_minor),
});

/** The open rounds, closing soonest first. */
export async function readOpenRounds(tx: Tx): Promise<OpenRound[]> {
  const rows = await openRounds(applicationsDb(tx))
    .select(roundColumns)
    .orderBy('r.closes_at')
    .orderBy('r.id')
    .execute();
  return rows.map(toOpenRound);
}

/** The round's latest published form version, which a new application pins. */
export async function latestPublishedForm(
  tx: Tx,
  roundId: string,
): Promise<{ id: string; definition: FormDefinition } | undefined> {
  const row = await applicationsDb(tx)
    .selectFrom('grants.form_version')
    .select(['id', 'definition'])
    .where('round_id', '=', roundId)
    .where('status', '=', 'published')
    .orderBy('version', 'desc')
    .limit(1)
    .executeTakeFirst();
  const definition = definitionOf(row?.definition ?? null);
  return row === undefined || definition === null ? undefined : { id: row.id, definition };
}

export async function readOpenRound(tx: Tx, roundId: string): Promise<OpenRoundDetail | undefined> {
  const row = await openRounds(applicationsDb(tx))
    .select([...roundColumns, 'p.description as programme_description'])
    .where('r.id', '=', roundId)
    .executeTakeFirst();
  const form = await latestPublishedForm(tx, roundId);
  if (row === undefined || form === undefined) return undefined;
  const round = toOpenRound(row);
  return {
    ...round,
    programme: { ...round.programme, description: row.programme_description },
    form,
  };
}
