// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Reading the team: its members, with the names and addresses the party
// module holds, and its pending invitations. Only fields the team page
// shows leave here; an account's password, MFA and sessions are not reachable.

import {
  consoleRoleSchema,
  type Invitation,
  type Member,
} from '@pixel-scientists/domain/platform/team';
import { contactDetails, peopleByUserIds } from '@pixel-scientists/party/server';

import type { TenantTransaction } from '../../database.ts';
import { teamTables, type MembershipRow } from './tables.ts';

const isConsoleRole = (role: string): role is Member['roles'][number] =>
  consoleRoleSchema.safeParse(role).success;

/**
 * The team's memberships that have not been removed, in id order: those that
 * hold a console role, so an applicant is never on it. Lock them to make
 * changes run one at a time.
 */
export function teamMemberships(tx: TenantTransaction, options: { lock: boolean }) {
  const query = teamTables(tx)
    .selectFrom('app.membership')
    .select(['id', 'user_id', 'roles', 'status'])
    .where('status', '<>', 'removed')
    .where((eb) => eb('roles', '&&', eb.val([...consoleRoleSchema.options])))
    .orderBy('id');
  return options.lock ? query.forNoKeyUpdate().execute() : query.execute();
}

type People = Awaited<ReturnType<typeof peopleByUserIds>>;

async function describe(
  tx: TenantTransaction,
  row: MembershipRow,
  people: People,
): Promise<Member> {
  const person = people.get(row.user_id);
  const contact = person && (await contactDetails(tx, person.personId));
  const name = [person?.givenName, person?.familyName].filter(Boolean).join(' ');
  return {
    id: row.id,
    name: name === '' ? null : name,
    // A member whose person record is missing shows no address.
    email: contact?.email ?? '',
    roles: row.roles.filter(isConsoleRole),
    status: row.status === 'suspended' ? 'suspended' : 'active',
  };
}

/** The members to show for these memberships, with their name and address from party. */
export async function toMembers(
  tx: TenantTransaction,
  rows: readonly MembershipRow[],
): Promise<Member[]> {
  const people = await peopleByUserIds(
    tx,
    rows.map((row) => row.user_id),
  );
  return Promise.all(rows.map((row) => describe(tx, row, people)));
}

/** The member to show for one membership. */
export async function toMember(tx: TenantTransaction, row: MembershipRow): Promise<Member> {
  return describe(tx, row, await peopleByUserIds(tx, [row.user_id]));
}

/** The pending invitations that have not expired, oldest first. */
export async function pendingInvitations(tx: TenantTransaction): Promise<Invitation[]> {
  const rows = await teamTables(tx)
    .selectFrom('app.invitation')
    .select(['id', 'email', 'roles', 'expires_at'])
    .where('status', '=', 'pending')
    .where((eb) => eb('expires_at', '>', eb.fn<Date>('now')))
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    roles: row.roles.filter(isConsoleRole),
    expiresAt: row.expires_at.toISOString(),
  }));
}
