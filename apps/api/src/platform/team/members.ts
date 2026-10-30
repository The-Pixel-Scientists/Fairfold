// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Changes to a team member (ADR 0010): roles, suspension, reinstatement and
// removal. Admins act on memberships only. Every change locks the team's
// memberships first, so two admins acting at once see each other's work;
// refuses the admin's own membership and any change that would leave the
// team with no active member who can manage it; and ends the member's
// sessions in this tenant when it takes access away. Each change writes
// its event, with role changes as values (D12).

import { permissionsFor } from '@pixel-scientists/domain/platform';
import type {
  changeMemberRoles,
  reinstateMember,
  removeMember,
  suspendMember,
} from '@pixel-scientists/domain/platform/team';

import type { AuditEvent } from '../../audit/writer.ts';
import type { MemberContext } from '../../context.ts';
import type { TenantTransaction } from '../../database.ts';
import { ApiError } from '../../problems.ts';
import type { Handler } from '../../routes/register.ts';
import type { TeamAuth } from './index.ts';
import { teamMemberships, toMember } from './read.ts';
import { teamTables, type MembershipRow } from './tables.ts';

const notFound = () => new ApiError(404, undefined, { reason: 'not_found' });

const refuse = (detail: string, reason: string) => new ApiError(409, detail, { reason });

type Change = Partial<Pick<MembershipRow, 'roles' | 'status'>>;

const canManage = (row: Pick<MembershipRow, 'roles' | 'status'>): boolean =>
  row.status === 'active' &&
  permissionsFor(row.roles, 'console').includes('platform.members.manage');

/** Whether `change` takes the team's last way to manage the team from `target`. */
export function leavesNoManager(
  team: readonly MembershipRow[],
  target: MembershipRow,
  change: Change,
): boolean {
  return (
    canManage(target) &&
    !canManage({ ...target, ...change }) &&
    !team.some((other) => other.id !== target.id && canManage(other))
  );
}

interface Plan {
  readonly change: Change;
  readonly action: AuditEvent['action'];
  readonly changes: NonNullable<AuditEvent['changes']>;
  /** Set when the change takes access away, to end the member's sessions. */
  readonly revoke?: 'membership_suspended' | 'membership_removed' | 'roles_changed';
}

interface Args {
  readonly tx: TenantTransaction;
  readonly context: MemberContext;
}

/** Make the change `plan` describes to the membership, and give the membership as it now is. */
async function change(
  auth: TeamAuth,
  { tx, context }: Args,
  membershipId: string,
  plan: (target: MembershipRow) => Plan | undefined,
): Promise<MembershipRow> {
  if (membershipId === context.membership.id) {
    throw refuse('You cannot change your own membership. Ask another administrator.', 'self');
  }
  const team = await teamMemberships(tx, { lock: true });
  const target = team.find((row) => row.id === membershipId);
  if (target === undefined) throw notFound();

  const next = plan(target);
  if (next === undefined) return target;
  if (leavesNoManager(team, target, next.change)) {
    throw refuse('The team needs at least one active administrator.', 'last_manager');
  }
  await teamTables(tx)
    .updateTable('app.membership')
    .set({ ...next.change, updated_by: context.membership.id })
    .where('id', '=', target.id)
    .execute();
  if (next.revoke !== undefined) {
    await auth.revokeSessionsForMembership(tx, {
      membershipId: target.id,
      tenant: context.session.tenant,
      requestId: context.requestId,
      reason: next.revoke,
    });
  }
  await context.audit.record({ action: next.action, entityId: target.id, changes: next.changes });
  return { ...target, ...next.change };
}

const statusChange = (before: MembershipRow['status'], after: MembershipRow['status']) => ({
  'app.membership.status': { before, after },
});

export const changeMemberRolesHandler =
  (auth: TeamAuth): Handler<typeof changeMemberRoles> =>
  async (args) => {
    const { roles } = args.input.body;
    const row = await change(auth, args, args.input.params.membershipId, (target) =>
      roles.length === target.roles.length && roles.every((role) => target.roles.includes(role))
        ? undefined
        : {
            change: { roles },
            action: 'platform.membership.roles_changed',
            changes: { 'app.membership.roles': { before: target.roles, after: roles } },
            revoke: 'roles_changed',
          },
    );
    return toMember(args.tx, row);
  };

export const suspendMemberHandler =
  (auth: TeamAuth): Handler<typeof suspendMember> =>
  async (args) =>
    toMember(
      args.tx,
      await change(auth, args, args.input.params.membershipId, (target) => {
        if (target.status !== 'active') throw refuse('This person is already suspended.', 'state');
        return {
          change: { status: 'suspended' },
          action: 'platform.membership.suspended',
          changes: statusChange('active', 'suspended'),
          revoke: 'membership_suspended',
        };
      }),
    );

export const reinstateMemberHandler =
  (auth: TeamAuth): Handler<typeof reinstateMember> =>
  async (args) =>
    toMember(
      args.tx,
      await change(auth, args, args.input.params.membershipId, (target) => {
        if (target.status !== 'suspended') throw refuse('This person is not suspended.', 'state');
        return {
          change: { status: 'active' },
          action: 'platform.membership.reinstated',
          changes: statusChange('suspended', 'active'),
        };
      }),
    );

export const removeMemberHandler =
  (auth: TeamAuth): Handler<typeof removeMember> =>
  async (args) => {
    await change(auth, args, args.input.params.membershipId, (target) => ({
      change: { status: 'removed' },
      action: 'platform.membership.removed',
      changes: statusChange(target.status, 'removed'),
      revoke: 'membership_removed',
    }));
    return undefined;
  };
