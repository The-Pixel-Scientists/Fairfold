// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What people can do (ADR 0004, ADR 0010, ADR 0016). Routes name a
// permission and a scope rule from here; roles (roles.ts) bundle the
// permissions. Code checks permissions, never role names. Labels are shown
// in the console.

import { z } from 'zod';

import type { ModuleId } from './modules.ts';

/** The app a session belongs to. Staff and reviewers use the console, applicants the portal. */
export const apps = ['console', 'portal'] as const;

export type App = (typeof apps)[number];

export const appSchema = z.enum(apps);

/** Which records a route's caller may reach, in which app. The module named implements the rule. */
export const scopeRules = {
  /** Any record in the session's tenant. */
  tenant: { module: 'platform', app: 'console' },
  /** An application assigned to the caller to review, with no declared conflict. */
  assigned_review: { module: 'grants', app: 'console' },
  /** The caller's own person record. */
  own_person: { module: 'party', app: 'portal' },
  /** An organisation the caller is a current contact for. */
  own_organisation: { module: 'party', app: 'portal' },
  /** An application made by the caller. */
  own_application: { module: 'grants', app: 'portal' },
  /**
   * A round taking applications: its programme is open, its opening time has
   * passed and its closing time has not, and it has a published form.
   */
  open_round: { module: 'grants', app: 'portal' },
  /** A form response made by the caller. */
  own_response: { module: 'forms', app: 'portal' },
  /**
   * A form taking responses from signed-in people: it has a published
   * version, its opening time has passed and its closing time has not.
   */
  open_form: { module: 'forms', app: 'portal' },
} as const satisfies Record<string, { module: ModuleId; app: App }>;

export type ScopeRule = keyof typeof scopeRules;

/**
 * Each permission works in one app, with the scope rules its routes may use.
 * `stepUp` marks those whose changes need re-authentication in the last
 * 5 minutes (ADR 0010).
 */
export const permissions = {
  'platform.settings.manage': {
    app: 'console',
    label: 'Change settings, theme and modules',
    scopes: ['tenant'],
  },
  'platform.members.manage': {
    app: 'console',
    label: 'Invite and manage team members',
    scopes: ['tenant'],
    stepUp: true,
  },
  'platform.audit.read': { app: 'console', label: 'Read the audit log', scopes: ['tenant'] },
  'platform.warehouse.export': {
    app: 'console',
    label: 'Download the warehouse snapshot',
    scopes: ['tenant'],
  },
  'platform.audit.export': {
    app: 'console',
    label: 'Export the audit log',
    scopes: ['tenant'],
    stepUp: true,
  },
  'platform.search.use': { app: 'console', label: 'Search across tools', scopes: ['tenant'] },
  'platform.retention.manage': {
    app: 'console',
    label: 'Change how long data is kept',
    scopes: ['tenant'],
    stepUp: true,
  },
  'platform.subject_access.request': {
    app: 'console',
    label: "Export a person's data for a subject access request",
    scopes: ['tenant'],
    stepUp: true,
  },
  'platform.erasure.request': {
    app: 'console',
    label: "Erase a person's data",
    scopes: ['tenant'],
    stepUp: true,
  },
  'platform.sso.manage': {
    app: 'console',
    label: 'Set up single sign-on',
    scopes: ['tenant'],
    stepUp: true,
  },
  'platform.approvals.read': {
    app: 'console',
    label: 'View approval requests',
    scopes: ['tenant'],
  },
  'platform.approvals.decide': {
    app: 'console',
    label: 'Approve or reject requests',
    scopes: ['tenant'],
    stepUp: true,
  },
  'party.records.read': {
    app: 'console',
    label: 'View organisations and people',
    scopes: ['tenant'],
  },
  'party.records.manage': {
    app: 'console',
    label: 'Edit organisations and people, verify identifiers and record relationships',
    scopes: ['tenant'],
  },
  'party.profile.manage': {
    app: 'portal',
    label: 'Manage your profile and organisations',
    scopes: ['own_person', 'own_organisation'],
  },
  'grants.programmes.manage': {
    app: 'console',
    label: 'Set up programmes, rounds and forms',
    scopes: ['tenant'],
  },
  'grants.applications.apply': {
    app: 'portal',
    label: 'Apply for funding',
    scopes: ['own_application', 'open_round'],
  },
  'grants.applications.read': { app: 'console', label: 'View applications', scopes: ['tenant'] },
  'grants.applications.triage': {
    app: 'console',
    label: 'Move applications between stages',
    scopes: ['tenant'],
  },
  'grants.reviews.assign': { app: 'console', label: 'Assign reviewers', scopes: ['tenant'] },
  'grants.reviews.score': {
    app: 'console',
    label: 'Score assigned applications',
    scopes: ['assigned_review'],
  },
  'grants.decisions.record': { app: 'console', label: 'Record decisions', scopes: ['tenant'] },
  'grants.decisions.release': {
    app: 'console',
    label: 'Release decisions to applicants',
    scopes: ['tenant'],
    stepUp: true,
  },
  'grants.data.export': {
    app: 'console',
    label: 'Export grants data for 360Giving',
    scopes: ['tenant'],
  },
  'grants.adjustments.manage': {
    app: 'console',
    label: 'Grant and revoke reasonable adjustments',
    scopes: ['tenant'],
  },
  'grants.applications.assist': {
    app: 'console',
    label: 'Start and submit applications for applicants who need another route',
    scopes: ['tenant'],
  },
  'grants.monitoring.disclose': {
    app: 'console',
    label: "Provide a person's equality monitoring answers for their own request",
    scopes: ['tenant'],
    stepUp: true,
  },
  'crm.records.read': {
    app: 'console',
    label: 'Search and view contacts and their timelines',
    scopes: ['tenant'],
  },
  'crm.records.manage': {
    app: 'console',
    label: 'Record interactions and external references',
    scopes: ['tenant'],
  },
  'crm.records.export': {
    app: 'console',
    label: 'Export contacts',
    scopes: ['tenant'],
    stepUp: true,
  },
  'crm.duplicates.review': {
    app: 'console',
    label: 'Review and dismiss possible duplicates',
    scopes: ['tenant'],
  },
  'crm.parties.merge': {
    app: 'console',
    label: 'Merge duplicate organisations and people',
    scopes: ['tenant'],
    stepUp: true,
  },
  'crm.lists.manage': { app: 'console', label: 'Manage lists', scopes: ['tenant'] },
  'crm.segments.manage': { app: 'console', label: 'Manage segments', scopes: ['tenant'] },
  'crm.imports.run': {
    app: 'console',
    label: 'Import organisations and people',
    scopes: ['tenant'],
    stepUp: true,
  },
  'assure.lookup.read': {
    app: 'console',
    label: 'View registry lookups and officers',
    scopes: ['tenant'],
  },
  'assure.lookup.run': { app: 'console', label: 'Refresh registry lookups', scopes: ['tenant'] },
  'assure.lookup.link': {
    app: 'console',
    label: 'Link registry officers to people',
    scopes: ['tenant'],
  },
  'assure.screening.read': {
    app: 'console',
    label: 'View sanctions screening and match decisions',
    scopes: ['tenant'],
  },
  'assure.screening.run': { app: 'console', label: 'Run sanctions screening', scopes: ['tenant'] },
  'assure.screening.decide': {
    app: 'console',
    label: 'Decide possible sanctions matches',
    scopes: ['tenant'],
    stepUp: true,
  },
  'assure.duplicates.review': {
    app: 'console',
    label: 'Review and dismiss duplicate application flags',
    scopes: ['tenant'],
  },
  'assure.checklists.manage': {
    app: 'console',
    label: 'Set up due diligence checklists',
    scopes: ['tenant'],
  },
  'assure.checklists.complete': {
    app: 'console',
    label: 'Complete due diligence checklists',
    scopes: ['tenant'],
  },
  'assure.visits.manage': { app: 'console', label: 'Record monitoring visits', scopes: ['tenant'] },
  'forms.forms.manage': {
    app: 'console',
    label: 'Build forms and change their settings',
    scopes: ['tenant'],
  },
  'forms.forms.publish': { app: 'console', label: 'Publish forms', scopes: ['tenant'] },
  /** Kept apart from building forms: a shorter period destroys responses. */
  'forms.retention.manage': {
    app: 'console',
    label: 'Change how long form responses are kept',
    scopes: ['tenant'],
    stepUp: true,
  },
  'forms.responses.read': { app: 'console', label: 'View form responses', scopes: ['tenant'] },
  'forms.responses.manage': {
    app: 'console',
    label: 'Mark form responses as spam',
    scopes: ['tenant'],
  },
  'forms.responses.export': {
    app: 'console',
    label: 'Export form responses',
    scopes: ['tenant'],
    stepUp: true,
  },
  'forms.responses.submit': {
    app: 'portal',
    label: 'Answer forms',
    scopes: ['own_response', 'open_form'],
  },
  'privacy.requests.manage': {
    app: 'console',
    label: 'Log and track data protection requests',
    scopes: ['tenant'],
  },
  'privacy.requests.export': {
    app: 'console',
    label: "Export a person's data for their request",
    scopes: ['tenant'],
    stepUp: true,
  },
  'privacy.requests.erase': {
    app: 'console',
    label: "Erase a person's data at their request",
    scopes: ['tenant'],
    stepUp: true,
  },
  'privacy.breaches.manage': {
    app: 'console',
    label: 'Record personal data breaches',
    scopes: ['tenant'],
  },
  'privacy.dpias.manage': {
    app: 'console',
    label: 'Write data protection impact assessments',
    scopes: ['tenant'],
  },
  'privacy.processing.manage': {
    app: 'console',
    label: 'Keep records of processing',
    scopes: ['tenant'],
  },
  'insight.reports.read': { app: 'console', label: 'Run and view reports', scopes: ['tenant'] },
  'insight.reports.manage': { app: 'console', label: 'Set up reports', scopes: ['tenant'] },
  'insight.publications.manage': {
    app: 'console',
    label: 'Prepare publications and annual returns',
    scopes: ['tenant'],
  },
  'insight.monitoring.report': {
    app: 'console',
    label: 'View equality monitoring totals, with small numbers hidden',
    scopes: ['tenant'],
  },
  'insight.disclosure_rules.manage': {
    app: 'console',
    label: 'Raise the thresholds that hide small numbers in reports',
    scopes: ['tenant'],
  },
} as const satisfies Record<
  `${ModuleId}.${string}.${string}`,
  { app: App; label: string; scopes: readonly ScopeRule[]; stepUp?: true }
>;

export type Permission = keyof typeof permissions;

export const permissionSchema = z.enum(Object.keys(permissions) as [Permission, ...Permission[]]);
