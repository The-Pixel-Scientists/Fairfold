// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Roles are bundles of permissions, held here as data (ADR 0016). A
// membership stores role names; code turns them into permissions with
// permissionsFor() and never checks a role name itself.

import { z } from 'zod';

import type { App, Permission } from './access.ts';

export const roles = {
  tenant_admin: {
    label: 'Administrator',
    app: 'console',
    permissions: [
      'platform.settings.manage',
      'platform.members.manage',
      'platform.audit.read',
      'platform.warehouse.export',
      'grants.data.export',
    ],
  },
  programme_manager: {
    label: 'Programme manager',
    app: 'console',
    permissions: [
      'party.records.read',
      'grants.programmes.manage',
      'grants.applications.read',
      'grants.applications.triage',
      'grants.reviews.assign',
      'grants.decisions.record',
      'grants.decisions.release',
    ],
  },
  reviewer: {
    label: 'Reviewer',
    app: 'console',
    permissions: ['grants.reviews.score'],
  },
  applicant: {
    label: 'Applicant',
    app: 'portal',
    permissions: ['party.profile.manage', 'grants.applications.apply'],
  },
} as const satisfies Record<
  string,
  { label: string; app: App; permissions: readonly Permission[] }
>;

export type Role = keyof typeof roles;

export const roleSchema = z.enum(Object.keys(roles) as [Role, ...Role[]]);

/**
 * The permissions a membership's roles give in one app. Roles for the other
 * app, and names that are not roles, give nothing, so a portal session never
 * carries a staff permission.
 */
export function permissionsFor(memberRoles: readonly string[], app: App): Permission[] {
  const granted = new Set<Permission>();
  for (const name of memberRoles) {
    if (!Object.hasOwn(roles, name)) continue;
    const role = roles[name as Role];
    if (role.app !== app) continue;
    for (const permission of role.permissions) granted.add(permission);
  }
  return [...granted];
}
