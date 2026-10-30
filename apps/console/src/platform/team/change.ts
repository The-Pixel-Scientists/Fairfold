// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What an administrator can do to the team: each change, the call that makes
// it, the words that confirm it, and its effect on the list on screen.

import { ProblemError } from '@pixel-scientists/domain/api';
import { roles } from '@pixel-scientists/domain/platform';
import type { Role } from '@pixel-scientists/domain/platform';
import {
  changeMemberRoles,
  inviteMember,
  reinstateMember,
  removeMember,
  revokeInvitation,
  suspendMember,
} from '@pixel-scientists/domain/platform/team';
import type { Invitation, Member, Team } from '@pixel-scientists/domain/platform/team';

import { callApi } from '../../api.ts';

export type Change =
  | { kind: 'invite'; email: string; roles: readonly Role[] }
  | { kind: 'roles'; member: Member; roles: readonly Role[] }
  | { kind: 'suspend' | 'reinstate' | 'remove'; member: Member }
  | { kind: 'revoke'; invitation: Invitation };

/** What the API says when an action needs a recent sign-in. It has no code of its own to match. */
export const STEP_UP_NEEDED = 'Confirm it is you again, then try again.';

export const needsStepUp = (error: unknown): boolean =>
  error instanceof ProblemError && error.status === 403 && error.detail === STEP_UP_NEEDED;

export const roleLabel = (role: Role): string => roles[role].label;

export const roleLabels = (list: readonly Role[]): string => list.map(roleLabel).join(', ');

/** The person's name, or their address until they have one. */
export const displayName = (member: Pick<Member, 'name' | 'email'>): string =>
  member.name ?? member.email;

export interface Outcome {
  /** Says what was done, naming who it was done to. */
  message: string;
  /** The list as it is after the change. */
  team: (current: Team) => Team;
}

const replaceMember = (updated: Member) => (current: Team) => ({
  ...current,
  members: current.members.map((member) => (member.id === updated.id ? updated : member)),
});

/** Makes the change. Throws the API's problem when it is refused. */
export async function perform(change: Change): Promise<Outcome> {
  switch (change.kind) {
    case 'invite': {
      const invitation = await callApi(inviteMember, {
        body: { email: change.email, roles: [...change.roles] },
      });
      return {
        message: `Invitation sent to ${invitation.email}. It works for 7 days.`,
        // A new invitation to an address replaces its earlier one.
        team: (current) => ({
          ...current,
          invitations: [
            ...current.invitations.filter(
              (earlier) => earlier.email.toLowerCase() !== invitation.email.toLowerCase(),
            ),
            invitation,
          ],
        }),
      };
    }
    case 'roles': {
      const updated = await callApi(changeMemberRoles, {
        params: { membershipId: change.member.id },
        body: { roles: [...change.roles] },
      });
      return {
        message: `Roles changed for ${displayName(updated)}: ${roleLabels(updated.roles)}.`,
        team: replaceMember(updated),
      };
    }
    case 'suspend': {
      const updated = await callApi(suspendMember, { params: { membershipId: change.member.id } });
      return {
        message: `${displayName(updated)} is suspended and signed out.`,
        team: replaceMember(updated),
      };
    }
    case 'reinstate': {
      const updated = await callApi(reinstateMember, {
        params: { membershipId: change.member.id },
      });
      return {
        message: `${displayName(updated)} can sign in again.`,
        team: replaceMember(updated),
      };
    }
    case 'remove':
      await callApi(removeMember, { params: { membershipId: change.member.id } });
      return {
        message: `${displayName(change.member)} is removed from the team and signed out.`,
        team: (current) => ({
          ...current,
          members: current.members.filter((member) => member.id !== change.member.id),
        }),
      };
    case 'revoke':
      await callApi(revokeInvitation, { params: { invitationId: change.invitation.id } });
      return {
        message: `The invitation to ${change.invitation.email} is revoked.`,
        team: (current) => ({
          ...current,
          invitations: current.invitations.filter(({ id }) => id !== change.invitation.id),
        }),
      };
  }
}
