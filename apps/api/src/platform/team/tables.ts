// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The tables the team routes query (migrations 0002 and 0015), as the API's
// role may reach them.

import type { TenantTransaction } from '../../database.ts';

export type MembershipStatus = 'active' | 'suspended' | 'removed';

/** A membership as the team routes read it. */
export interface MembershipRow {
  readonly id: string;
  readonly user_id: string;
  readonly roles: string[];
  readonly status: MembershipStatus;
}

type TeamTables = {
  'app.membership': MembershipRow & { updated_by: string };
  'app.invitation': {
    id: string;
    email: string;
    roles: string[];
    status: string;
    expires_at: Date;
    created_at: Date;
  };
};

export const teamTables = (tx: TenantTransaction) => tx.$extendTables<TeamTables>();
