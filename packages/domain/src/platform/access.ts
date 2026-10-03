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
  'party.records.read': {
    app: 'console',
    label: 'View organisations and people',
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
    scopes: ['own_application'],
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
} as const satisfies Record<
  `${ModuleId}.${string}.${string}`,
  { app: App; label: string; scopes: readonly ScopeRule[]; stepUp?: true }
>;

export type Permission = keyof typeof permissions;

export const permissionSchema = z.enum(Object.keys(permissions) as [Permission, ...Permission[]]);
