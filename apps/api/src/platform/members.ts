// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The members port that modules declare as a dependency (ADR 0016): the
// tenant's active members who hold a permission. It asks permissionsFor(),
// so it never reads a role name, and row-level security keeps it inside the
// request's tenant.

import { permissions, permissionsFor, type Permission } from '@pixel-scientists/domain/platform';

import type { TenantTransaction } from '../database.ts';

type MemberTables = { 'app.membership': { id: string; roles: string[]; status: string } };

/** The ids of the active members whose roles give `permission`, in id order. */
export async function membersWith(
  tx: TenantTransaction,
  permission: Permission,
): Promise<string[]> {
  const rows = await tx
    .$extendTables<MemberTables>()
    .selectFrom('app.membership')
    .select(['id', 'roles'])
    .where('status', '=', 'active')
    .orderBy('id')
    .execute();
  const { app } = permissions[permission];
  return rows
    .filter((row) => permissionsFor(row.roles, app).includes(permission))
    .map((row) => row.id);
}
