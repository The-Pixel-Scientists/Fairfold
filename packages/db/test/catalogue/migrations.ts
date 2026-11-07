// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The catalogue test's allowlists for the migrations schema.

import type { SchemaCatalogue } from './index.ts';

export const migrations: SchemaCatalogue = {
  excepted:
    "Kysely's migration history, which only migrator uses. The lint checks that no app role can use the schema, and checks its grants and functions like any other.",
};
