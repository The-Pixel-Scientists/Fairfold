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

import { z } from 'zod';

import { fileTypes } from '../files/types.ts';
import type { Permission, ScopeRule } from '../platform/access.ts';
import { moduleIds, type ModuleId } from '../platform/modules.ts';
import { accessProblems, type AuthSession } from './access-rules.ts';
import { isObject, keysOf, list, schemaNodes, toJsonSchema } from './json-schema.ts';
import {
  exportContentTypes,
  isRawBody,
  paramProblems,
  rawBodyProblems,
  rawContentTypes,
  rawUploadProblems,
  requestProblems,
  responseProblems,
  type RawUploadBody,
  type RequestBody,
  type ResponseBody,
} from './schema-rules.ts';

/** Who calls a route. Paths start with it: `/console/…`, `/portal/…`, `/public/…`, `/auth/…`. */
export const audiences = ['console', 'portal', 'public', 'auth'] as const;

export type Audience = (typeof audiences)[number];

export const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

export type Method = (typeof methods)[number];

/** The request header an idempotent route's key travels in (ADR 0028); never a body, query or path value. */
export const idempotencyKeyHeader = 'Idempotency-Key';

/**
 * A version 4 or 7 uuid in its 36-character form, in either case, compared
 * in lower case. Stricter than z.uuid(), which takes every version and the
 * nil and max uuids.
 */
export const idempotencyKeySchema = z
  .stringFormat(
    'uuid',
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[47][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/,
  )
  .toLowerCase();

/**
 * An idempotent route's request headers, for its schema and the OpenAPI
 * document: the key, required. A request carries other headers too; parsing
 * keeps only the key, the one header this schema declares.
 */
export const idempotencyHeadersSchema = z.object({
  [idempotencyKeyHeader.toLowerCase()]: idempotencyKeySchema,
});

interface RouteBase {
  readonly method: Method;
  /** Lower case segments, with `:name` for each path parameter. */
  readonly path: string;
  readonly module: ModuleId;
  /** One line for the OpenAPI document. */
  readonly summary: string;
  readonly params?: z.ZodType;
  readonly query?: z.ZodType;
  /**
   * JSON, or `{ raw: ['application/octet-stream'], maxBytes }` for a file's
   * bytes on a console or portal `POST` route, with the file's name in the
   * `File-Name` header (ADR 0047).
   */
  readonly body?: RequestBody;
  /**
   * Success responses by status; `null` means no body, and `{ raw: [...] }` a
   * body that is not JSON, in the content types named. Errors are always
   * problem details.
   */
  readonly responses: Readonly<Record<number, ResponseBody>>;
  /**
   * On a POST: a repeat with the same `Idempotency-Key` answers the first
   * result instead of acting again (ADR 0028). Required on a POST that
   * answers 201, except on an auth route, which never has it.
   */
  readonly idempotent?: true;
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
  readonly module: 'platform';
  readonly permission: null;
  readonly scope: null;
  readonly session: AuthSession;
  /** Needs re-authentication in the last 5 minutes (ADR 0010); only with a complete session. */
  readonly stepUp?: boolean;
  /**
   * One of the ends of an SSO sign-in (ADR 0010), the only routes that
   * answer a redirect: `303` with no body, to a `Location` the server sets,
   * never from a request value. `saml_acs` is the SAML ACS POST, which takes
   * a form body of `SAMLResponse` and `RelayState` and is the one route
   * exempt from the Origin check.
   */
  readonly ssoCompletion?: SsoCompletion;
}

interface PublicRoute extends RouteBase {
  readonly audience: 'public';
  readonly permission: null;
  readonly scope: null;
}

export type RouteContract = MemberRoute | AuthRoute | PublicRoute;

export const ssoCompletions = ['oidc_callback', 'saml_acs', 'saml_completion'] as const;

export type SsoCompletion = (typeof ssoCompletions)[number];

/** The SAML ACS form fields, sorted: the IdP's response and our own opaque value. */
const SAML_FORM = 'RelayState,SAMLResponse';

/** A route whose body is JSON or none, and whose every response is JSON or empty: the only kind call() takes. */
export type JsonRouteContract = RouteContract & {
  readonly body?: z.ZodType;
  readonly responses: Readonly<Record<number, z.ZodType | null>>;
};

/** A route that takes a file's bytes and answers JSON: the only kind upload() takes. */
export type UploadRouteContract = RouteContract & {
  readonly body: RawUploadBody;
  readonly responses: Readonly<Record<number, z.ZodType | null>>;
};

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
  problems.push(...accessProblems(route), ...markerProblems(route), ...redirectProblems(route));

  const pathParams = rest.filter((segment) => segment.startsWith(':')).map((s) => s.slice(1));
  problems.push(...paramProblems(pathParams, route.params));
  for (const part of ['params', 'query'] as const) {
    const schema = route[part];
    if (schema !== undefined) {
      problems.push(...requestProblems(route.path, part, schema), ...keyNameProblems(part, schema));
    }
  }
  const { body } = route;
  if (isRawBody(body)) {
    problems.push(...rawUploadProblems(body));
    if (route.method !== 'POST' || !isMember(route.audience)) {
      problems.push('Only a console or portal POST route takes a raw upload body.');
    }
  } else if (body !== undefined) {
    problems.push(...requestProblems(route.path, 'body', body), ...keyNameProblems('body', body));
  }

  const responses = Object.entries(route.responses);
  if (responses.length === 0) problems.push('The route needs at least one success response.');
  for (const [status, body] of responses) {
    // A redirect is checked by redirectProblems(); anywhere else it is refused below.
    if (status === '303' && Object.hasOwn(route, 'ssoCompletion')) continue;
    if (!isRawBody(body)) {
      problems.push(...responseProblems(status, body));
      continue;
    }
    const allowed = rawResponseTypes(route);
    if (allowed === null)
      problems.push('Only a public, console or portal GET route answers a raw body.');
    else problems.push(...rawBodyProblems(status, body, allowed));
  }
  return problems;
}

function markerProblems(route: RouteContract): string[] {
  const { idempotent } = route as { idempotent?: unknown };
  const problems: string[] = [];
  const creates = route.method === 'POST' && Object.hasOwn(route.responses, 201);
  if (creates && route.audience !== 'auth' && idempotent !== true) {
    problems.push('A POST that creates must be idempotent.');
  }
  if (idempotent === undefined) return problems;
  if (idempotent !== true) problems.push('idempotent is true or left out.');
  if (route.method !== 'POST') problems.push('Only a POST route is idempotent.');
  if (route.audience === 'auth') problems.push('An auth route is never idempotent.');
  return problems;
}

/** An SSO completion answers a bare 303 and nothing else, with no session, and only the ACS takes a body. */
function redirectProblems(route: RouteContract): string[] {
  if (!Object.hasOwn(route, 'ssoCompletion')) return [];
  const { audience, ssoCompletion, session } = route as {
    audience: unknown;
    ssoCompletion: unknown;
    session?: unknown;
  };
  const problems: string[] = [];
  if (audience !== 'auth' || !ssoCompletions.some((value) => value === ssoCompletion)) {
    problems.push(`Only an auth route is an SSO completion: ${ssoCompletions.join(', ')}.`);
  }
  if (session !== 'none') problems.push('An SSO completion needs no session.');
  if (Object.keys(route.responses).join() !== '303' || route.responses[303] !== null) {
    problems.push('An SSO completion answers 303 with no body, and nothing else.');
  }
  const acs = ssoCompletion === 'saml_acs';
  if (route.method !== (acs ? 'POST' : 'GET')) {
    problems.push(`The ${String(ssoCompletion)} route is a ${acs ? 'POST' : 'GET'}.`);
  }
  if (acs && formFields(route.body) !== SAML_FORM) {
    problems.push('The SAML ACS body is a form of SAMLResponse and RelayState, both text.');
  }
  return problems;
}

/** A body's fields, sorted, when every one is required text; otherwise null. */
function formFields(body: RouteContract['body']): string | null {
  const root = body === undefined || isRawBody(body) ? undefined : toJsonSchema(body, 'input');
  const properties = root?.['properties'];
  if (root === undefined || !isObject(properties)) return null;
  const names = Object.keys(properties).sort();
  const text = Object.values(properties).every(
    (node) => isObject(node) && node['type'] === 'string',
  );
  const required = list(root['required']);
  return text && names.every((name) => required.includes(name)) ? names.join() : null;
}

/** The idempotency key travels in its header, never in a request schema, in any spelling. */
function keyNameProblems(part: 'params' | 'query' | 'body', schema: z.ZodType): string[] {
  const problems = new Set<string>();
  for (const io of ['input', 'output'] as const) {
    const root = toJsonSchema(schema, io);
    for (const node of root === undefined ? [] : schemaNodes(root)) {
      for (const key of keysOf(node)) {
        if (key.toLowerCase().replace(/[-_]/g, '').includes('idempotencykey')) {
          problems.add(
            `${part} names "${key}"; the key travels in the ${idempotencyKeyHeader} header.`,
          );
        }
      }
    }
  }
  return [...problems];
}

function isMember(audience: Audience): boolean {
  return audience === 'console' || audience === 'portal';
}

/**
 * The content types a route may answer raw, or null if it may not: a GET
 * route only, a stylesheet or an image for the public, a stored file's type
 * for the console and portal (ADR 0047), and an export's for the console
 * (S10-01). Never on auth routes.
 */
function rawResponseTypes(route: RouteContract): readonly string[] | null {
  if (route.method !== 'GET') return null;
  if (route.audience === 'public') return rawContentTypes;
  if (route.audience === 'console') return [...fileTypes, ...exportContentTypes];
  return route.audience === 'portal' ? fileTypes : null;
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
