// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A tenant's team as its admins see and change it (ADR 0010): members of the
// console and their pending invitations. Admins act on memberships only, so
// nothing here reaches an account's password, MFA or sessions.

import { z } from 'zod';

import { emailSchema } from '../../auth/schemas.ts';
import { idSchema } from '../../id.ts';
import { messages } from '../messages.ts';
import { roles, type Role } from '../roles.ts';

const consoleRoles = (Object.keys(roles) as Role[]).filter((id) => roles[id].app === 'console');

/** The roles a team member can hold. Applicants are never invited (out of scope in MVP1). */
export const consoleRoleSchema = z.enum(consoleRoles as [Role, ...Role[]]);

/** At least one console role, each once. */
export const teamRolesSchema = z
  .array(consoleRoleSchema)
  .min(1, { error: messages.chooseRole })
  .max(consoleRoles.length)
  .refine((chosen) => new Set(chosen).size === chosen.length);

export const inviteSchema = z.strictObject({ email: emailSchema, roles: teamRolesSchema });

export const rolesChangeSchema = z.strictObject({ roles: teamRolesSchema });

export const memberStatuses = ['active', 'suspended'] as const;

/** A membership of the tenant. A removed one is no longer listed. */
export const memberSchema = z.object({
  /** The membership's id. */
  id: idSchema,
  /** From the member's person record; null when it has no name yet. */
  name: z.string().nullable(),
  email: z.string(),
  roles: z.array(consoleRoleSchema),
  status: z.enum(memberStatuses),
});

export type Member = z.infer<typeof memberSchema>;

/** A pending invitation. Accepted, revoked and expired ones are not listed. */
export const invitationSchema = z.object({
  id: idSchema,
  email: z.string(),
  roles: z.array(consoleRoleSchema),
  expiresAt: z.iso.datetime(),
});

export type Invitation = z.infer<typeof invitationSchema>;

export const teamSchema = z.object({
  members: z.array(memberSchema),
  invitations: z.array(invitationSchema),
});

export type Team = z.infer<typeof teamSchema>;
