// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The one call behind browsing before sign-in (ADR 0035): the public fields
// of a tenant's open rounds, by slug, from grants.public_open_rounds(). The
// function resolves the tenant inside itself, so no tenant is set on the
// connection, and it returns nothing for every case that must read as not
// found. The slug is a bound parameter and is compared exactly.

import type { Kysely } from '@pixel-scientists/db';

/** The function's columns, as the driver returns them: bigints as text, instants as dates. */
export interface OpenRoundRow {
  round_id: string;
  programme_title: string;
  programme_summary: string;
  round_title: string;
  opens_at: Date;
  closes_at: Date;
  timezone: string;
  award_min_minor: string;
  award_max_minor: string;
  currency: string;
  eligibility: unknown;
}

export const readOpenRounds = (db: Kysely<unknown>, slug: string): Promise<OpenRoundRow[]> =>
  db
    .selectFrom((eb) =>
      eb.fn<OpenRoundRow>('grants.public_open_rounds', [eb.val(slug)]).as('open_round'),
    )
    .selectAll()
    .execute();
