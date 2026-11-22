// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The tables the team handlers query (migration 0099 and 0002), as the API's
// role may reach them: `app_api` may write only the columns named here, and
// the database sets the archive and removal times.

import type { TenantTransaction } from '../../database.ts';

/** A column the database fills in, so an insert may leave it out (kysely's `Generated`). */
type Generated<T> = { __select__: T; __insert__: T | undefined; __update__: T };

export interface TeamRow {
  readonly id: string;
  readonly name: string;
  readonly archived_at: Date | null;
}

type TeamTables = {
  'app.team': {
    tenant_id: string;
    id: Generated<string>;
    name: string;
    archived_at: Date | null;
    archived_by: string | null;
    created_by: string;
    updated_by: string;
  };
  'app.team_member': {
    tenant_id: string;
    id: Generated<string>;
    team_id: string;
    membership_id: string;
    removed_at: Date | null;
    removed_by: string | null;
    created_by: string;
    updated_by: string;
  };
  'app.membership': { id: string; user_id: string; roles: string[]; status: string };
};

export const teamTables = (tx: TenantTransaction) => tx.$extendTables<TeamTables>();
