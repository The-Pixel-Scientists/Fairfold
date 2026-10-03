// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Route contracts (ADR 0004). Every API route is a plain object defined
// here or in a module's contracts: what it accepts, what it answers, and who
// may call it. The API registers routes from them, the policy module enforces
// their permission and scope, and the apps call them with call().
//
// defineRoute() refuses a contract that breaks the path rules below, the
// access rules (access-rules.ts) or the schema rules (schema-rules.ts), when
// the module defining it loads. Contract tests run checkRoute() over every
// route.

import type { z } from 'zod';

import type { Permission, ScopeRule } from '../platform/access.ts';
import { moduleIds, type ModuleId } from '../platform/modules.ts';
import { accessProblems, type AuthSession } from './access-rules.ts';
import { paramProblems, requestProblems, responseProblems } from './schema-rules.ts';

/** Who calls a route. Paths start with it: `/console/…`, `/portal/…`, `/public/…`, `/auth/…`. */
export const audiences = ['console', 'portal', 'public', 'auth'] as const;

export type Audience = (typeof audiences)[number];

export const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

export type Method = (typeof methods)[number];

interface RouteBase {
  readonly method: Method;
  /** Lower case segments, with `:name` for each path parameter. */
  readonly path: string;
  readonly module: ModuleId;
  /** One line for the OpenAPI document. */
  readonly summary: string;
  readonly params?: z.ZodType;
  readonly query?: z.ZodType;
  readonly body?: z.ZodType;
  /** Success responses by status; `null` means no body. Errors are always problem details. */
  readonly responses: Readonly<Record<number, z.ZodType | null>>;
}

/** A signed-in route: a permission held in the active tenant, and the records it may reach. */
interface MemberRoute extends RouteBase {
  readonly audience: 'console' | 'portal';
  readonly permission: Permission;
  readonly scope: ScopeRule;
  /** Needs re-authentication in the last 5 minutes (ADR 0010); required for changes under a step-up permission. */
  readonly stepUp?: boolean;
}

interface AuthRoute extends RouteBase {
  readonly audience: 'auth';
  readonly permission: null;
  readonly scope: null;
  readonly session: AuthSession;
}

interface PublicRoute extends RouteBase {
  readonly audience: 'public';
  readonly permission: null;
  readonly scope: null;
}

export type RouteContract = MemberRoute | AuthRoute | PublicRoute;

const LITERAL_SEGMENT = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/;
const PARAM_SEGMENT = /^:[a-z][A-Za-z0-9]*$/;

/** Everything wrong with a route contract, as sentences. Empty when it keeps every rule. */
export function checkRoute(route: RouteContract): string[] {
  const problems: string[] = [];
  const [root, audience, ...rest] = route.path.split('/');
  if (!audiences.includes(route.audience)) problems.push(`Unknown audience ${route.audience}.`);
  if (root !== '' || audience !== route.audience || rest.length === 0) {
    problems.push(`The path must start with /${route.audience}/.`);
  }
  for (const segment of rest) {
    if (!LITERAL_SEGMENT.test(segment) && !PARAM_SEGMENT.test(segment)) {
      problems.push(`The path segment "${segment}" is not lower case, nor a :parameter.`);
    }
  }
  if (!methods.includes(route.method)) problems.push(`Unknown method ${route.method}.`);
  if (!moduleIds.includes(route.module)) problems.push(`Unknown module ${route.module}.`);
  if (route.summary.trim() === '') problems.push('The route needs a summary.');
  if ((route.method === 'GET' || route.method === 'DELETE') && route.body !== undefined) {
    problems.push(`A ${route.method} route takes no body.`);
  }
  problems.push(...accessProblems(route));

  const pathParams = rest.filter((segment) => segment.startsWith(':')).map((s) => s.slice(1));
  problems.push(...paramProblems(pathParams, route.params));
  for (const part of ['params', 'query', 'body'] as const) {
    const schema = route[part];
    if (schema !== undefined) problems.push(...requestProblems(route.path, part, schema));
  }

  const responses = Object.entries(route.responses);
  if (responses.length === 0) problems.push('The route needs at least one success response.');
  for (const [status, schema] of responses) problems.push(...responseProblems(status, schema));
  return problems;
}

/** Returns the contract unchanged, or throws if it breaks a rule. */
export function defineRoute<const C extends RouteContract>(route: C): C {
  const problems = checkRoute(route);
  if (problems.length > 0) {
    throw new Error(
      `${route.method} ${route.path} breaks the route rules:\n- ${problems.join('\n- ')}`,
    );
  }
  return route;
}
