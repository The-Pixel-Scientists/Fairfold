// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Who may call a route (ADR 0004, ADR 0010), as checkRoute() checks it:
//   - console and portal routes need a permission of their own module and
//     app, a scope rule of that app which the permission uses, and
//     `stepUp: true` for changes under a step-up permission;
//   - auth and public routes have neither, and auth routes state the session
//     they need.
// The fields are read as unknown: a cast or plain JavaScript can get past
// the types.

import { permissions, scopeRules, type Permission, type ScopeRule } from '../platform/access.ts';

/**
 * The session an `auth` route needs: none (one that is present is ignored),
 * one waiting for MFA and nothing else, any (signing out and reading the
 * session only), or a complete one.
 */
export const authSessions = ['none', 'mfa_pending', 'any', 'complete'] as const;

export type AuthSession = (typeof authSessions)[number];

/** The fields of a route contract these rules read. */
interface AccessFields {
  readonly method: string;
  readonly audience: string;
  readonly module: string;
  readonly permission?: unknown;
  readonly scope?: unknown;
  readonly session?: unknown;
  readonly stepUp?: unknown;
}

export function accessProblems(route: AccessFields): string[] {
  const { method, audience, module, permission, scope, session, stepUp } = route;
  const problems: string[] = [];
  if (audience === 'console' || audience === 'portal') {
    if (typeof permission !== 'string' || !Object.hasOwn(permissions, permission)) {
      return ['The permission is not in the catalogue.'];
    }
    const granted = permissions[permission as Permission];
    if (!permission.startsWith(`${module}.`)) {
      problems.push(`The permission ${permission} belongs to another module.`);
    }
    if (granted.app !== audience) {
      problems.push(`The permission ${permission} is not for the ${audience}.`);
    }
    if (typeof scope !== 'string' || !Object.hasOwn(scopeRules, scope)) {
      problems.push('The scope rule is not in the catalogue.');
    } else if (
      scopeRules[scope as ScopeRule].app !== audience ||
      !(granted.scopes as readonly string[]).includes(scope)
    ) {
      problems.push(`The scope rule ${scope} is not one ${permission} uses in the ${audience}.`);
    }
    if (stepUp !== undefined && typeof stepUp !== 'boolean') {
      problems.push('stepUp is true or false.');
    }
    if ('stepUp' in granted && method !== 'GET' && stepUp !== true) {
      problems.push(`Changes under ${permission} need stepUp: true.`);
    }
    if (session !== undefined) problems.push('Only auth routes state a session.');
    return problems;
  }
  if (permission !== null || scope !== null) {
    problems.push(`A ${audience} route has no permission or scope.`);
  }
  if (stepUp !== undefined) problems.push('Only console and portal routes can need step-up.');
  if (audience === 'auth' && !authSessions.some((value) => value === session)) {
    problems.push(`An auth route states the session it needs: ${authSessions.join(', ')}.`);
  }
  if (audience === 'public' && session !== undefined) {
    problems.push('Only auth routes state a session.');
  }
  return problems;
}
