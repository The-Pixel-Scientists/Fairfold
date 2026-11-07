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
      'platform.audit.export',
      'platform.search.use',
      'platform.retention.manage',
      'platform.subject_access.request',
      'platform.erasure.request',
      'platform.sso.manage',
      'grants.data.export',
      'crm.records.export',
      'forms.responses.export',
      'forms.retention.manage',
      'privacy.requests.manage',
      'privacy.requests.export',
      'privacy.requests.erase',
      'privacy.breaches.manage',
      'privacy.dpias.manage',
      'privacy.processing.manage',
      'insight.disclosure_rules.manage',
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
      'platform.search.use',
      'platform.approvals.read',
      'platform.approvals.decide',
      'party.records.manage',
      'grants.adjustments.manage',
      'grants.applications.assist',
      'crm.records.read',
      'crm.records.manage',
      'crm.duplicates.review',
      'crm.parties.merge',
      'crm.lists.manage',
      'crm.segments.manage',
      'crm.imports.run',
      'assure.lookup.read',
      'assure.screening.read',
      'assure.visits.manage',
      'forms.forms.manage',
      'forms.forms.publish',
      'forms.responses.read',
      'forms.responses.manage',
      'insight.reports.read',
    ],
  },
  reviewer: {
    label: 'Reviewer',
    app: 'console',
    permissions: ['grants.reviews.score', 'platform.search.use'],
  },
  due_diligence_officer: {
    label: 'Due diligence officer',
    app: 'console',
    permissions: [
      'platform.search.use',
      'party.records.read',
      'assure.lookup.read',
      'assure.lookup.run',
      'assure.lookup.link',
      'assure.screening.read',
      'assure.screening.run',
      'assure.screening.decide',
      'assure.duplicates.review',
      'assure.checklists.manage',
      'assure.checklists.complete',
      'assure.visits.manage',
    ],
  },
  /** Only for answering a person's own request, never for anyone who assesses or decides (ADR 0032). */
  data_protection_lead: {
    label: 'Data protection lead',
    app: 'console',
    permissions: ['grants.monitoring.disclose'],
  },
  analyst: {
    label: 'Analyst',
    app: 'console',
    permissions: [
      'platform.search.use',
      'insight.reports.read',
      'insight.reports.manage',
      'insight.publications.manage',
      'insight.monitoring.report',
    ],
  },
  applicant: {
    label: 'Applicant',
    app: 'portal',
    permissions: ['party.profile.manage', 'grants.applications.apply', 'forms.responses.submit'],
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
