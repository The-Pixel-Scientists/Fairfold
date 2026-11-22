// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The one call behind the public embed origins route: app.embed_origins(),
// which resolves the tenant from the slug inside itself. No tenant is set.

import type { Kysely } from '@pixel-scientists/db';

export async function readEmbedOrigins(db: Kysely<unknown>, slug: string): Promise<string[]> {
  const rows = await db
    .selectFrom((eb) => eb.fn<{ origin: string }>('app.embed_origins', [eb.val(slug)]).as('o'))
    .select('o.origin')
    .execute();
  return rows.map((row) => row.origin);
}
