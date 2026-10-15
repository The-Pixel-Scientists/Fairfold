// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Registers API routes from their contracts (ADR 0004). A contract says what
// a route accepts, answers and needs; this file turns it into a Fastify route
// whose requests are validated strictly and whose responses are encoded
// through the contract's schema, and puts the policy (../policy) in front of
// the handler. A handler gets only what the contract and the policy give it:
// the parsed input, the context, and for a console or portal route the
// request's tenant transaction. It never checks access itself.

import {
  checkRoute,
  isRawBody,
  problemSchema,
  type RawBody,
  type RouteContract,
} from '@pixel-scientists/domain/api';
import { modules } from '@pixel-scientists/domain/platform';
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  FastifySchema,
  RouteGenericInterface,
  RouteOptions,
} from 'fastify';
import { z } from 'zod';

import type { MemberContext, RequestContext, SessionRead } from '../context.ts';
import type { InTenant, TenantTransaction } from '../database.ts';
import { ApiError, handleError, handleNotFound, PROBLEM_CONTENT_TYPE } from '../problems.ts';
import { asMember, checkSession, type ScopeInput, type ScopeResolvers } from '../policy/index.ts';

type MemberAudience = 'console' | 'portal';

type Part<K extends 'params' | 'query' | 'body', C> = C extends {
  readonly [P in K]: infer S extends z.ZodType;
}
  ? { readonly [P in K]: z.output<S> }
  : { readonly [P in K]?: undefined };

/** The parsed request: only the parts the contract declares. */
export type Input<C extends RouteContract> = Part<'params', C> & Part<'query', C> & Part<'body', C>;

/** The answer of a route whose contract names raw content types: the bytes, sent as they are. */
export interface RawReply<T extends string = string> {
  readonly type: T;
  readonly body: string | Uint8Array;
  /** Headers to add, such as `Content-Disposition`. */
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * What a handler returns: the body of its response, which is encoded through
 * the contract, or for a raw response the content type and bytes.
 */
export type Output<C extends RouteContract> = {
  [S in keyof C['responses']]: C['responses'][S] extends z.ZodType
    ? z.output<C['responses'][S]>
    : C['responses'][S] extends RawBody
      ? RawReply<C['responses'][S]['raw'][number]>
      : undefined;
}[keyof C['responses']];

export type Handler<C extends RouteContract> = C extends { readonly audience: MemberAudience }
  ? (args: { tx: TenantTransaction; context: MemberContext; input: Input<C> }) => Promise<Output<C>>
  : (args: { context: RequestContext; input: Input<C> }) => Promise<Output<C>>;

interface HandlerArgs {
  tx?: TenantTransaction;
  context: RequestContext;
  input: ScopeInput;
}

/** A contract and its handler. Make one with route(), which checks the two fit. */
export interface Route {
  readonly contract: RouteContract;
  readonly handler: (args: HandlerArgs) => Promise<unknown>;
  /** The largest request body in bytes, where the server's default is too small. */
  readonly bodyLimit?: number;
}

export function route<const C extends RouteContract>(
  contract: C,
  handler: Handler<C>,
  options: { bodyLimit?: number } = {},
): Route {
  return { contract, handler: handler as unknown as Route['handler'], ...options };
}

export interface RouteDependencies {
  readSession: (request: FastifyRequest) => Promise<SessionRead>;
  inTenant: InTenant;
  resolvers: ScopeResolvers;
}

const PROBLEM_STATUSES: Record<RouteContract['audience'], readonly number[]> = {
  console: [400, 401, 403, 404],
  portal: [400, 401, 403, 404],
  auth: [400, 401, 403, 404],
  public: [400, 404],
};

const problemResponse = {
  description: 'Problem details (RFC 9457).',
  content: { [PROBLEM_CONTENT_TYPE.split(';')[0] ?? '']: { schema: problemSchema } },
};

/** Set on a route's config by registerRoutes() alone, so nothing else can pass for a contract route. */
const FROM_CONTRACT = Symbol('route registered from a contract');

interface RouteConfig {
  contract: RouteContract;
  [FROM_CONTRACT]: true;
}

export const isRegisteredFromContract = (options: Pick<RouteOptions, 'config'>): boolean =>
  (options.config as Record<symbol, unknown> | undefined)?.[FROM_CONTRACT] === true;

/** How the OpenAPI document shows a raw body: bytes, whatever their type. */
const rawSchema = z.string().meta({ format: 'binary' });

/** Text is sent as UTF-8. */
const withCharset = (type: string): string =>
  type.startsWith('text/') ? `${type}; charset=utf-8` : type;

function schemaFor(contract: RouteContract, status: number): FastifySchema {
  const raw = contract.responses[status];
  const success = isRawBody(raw)
    ? {
        description: 'The bytes as they are.',
        content: Object.fromEntries(raw.raw.map((type) => [type, { schema: rawSchema }])),
      }
    : raw;
  return {
    tags: [modules[contract.module].label],
    summary: contract.summary,
    // Only the parts the contract declares: Fastify warns about a key that is set and empty.
    ...(contract.params === undefined ? {} : { params: contract.params }),
    // A part the contract does not declare takes nothing: an unknown query key is refused.
    querystring: contract.query ?? z.strictObject({}),
    ...(contract.body === undefined ? {} : { body: contract.body }),
    response: {
      [status]: success ?? { description: 'No content.', content: {} },
      ...Object.fromEntries(PROBLEM_STATUSES[contract.audience].map((s) => [s, problemResponse])),
    },
  };
}

/** A malformed path parameter on a public route reads as an unknown tenant: one answer for both. */
function missingForBadParams(error: unknown, request: FastifyRequest, reply: FastifyReply): void {
  const { validation, validationContext } = error as {
    validation?: unknown;
    validationContext?: unknown;
  };
  if (Array.isArray(validation) && validationContext === 'params') {
    request.log.info({ status: 404, reason: 'bad_slug' }, 'The request was refused');
    handleNotFound(request, reply);
    return;
  }
  handleError(error, request, reply);
}

/**
 * Refuses, with an error that stops start-up, any route that cannot be served
 * safely: one that breaks the contract rules (so one built without
 * defineRoute() is caught), has more than one success response, or has a
 * scope rule nobody resolves.
 */
function checkRegistration(contract: RouteContract, deps: RouteDependencies): void {
  const problems = checkRoute(contract);
  if (Object.keys(contract.responses).length !== 1) {
    problems.push('The API registers routes with exactly one success response.');
  }
  if (contract.audience === 'console' || contract.audience === 'portal') {
    if (deps.resolvers[contract.scope] === undefined) {
      problems.push(`No module registered the scope rule ${contract.scope}.`);
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `${contract.method} ${contract.path} cannot be registered:\n- ${problems.join('\n- ')}`,
    );
  }
}

export function registerRoutes(
  app: FastifyInstance,
  routes: readonly Route[],
  deps: RouteDependencies,
): void {
  // What each request's onRequest hook found, for its handler.
  const contexts = new WeakMap<FastifyRequest, RequestContext>();

  for (const { contract, handler, bodyLimit } of routes) {
    checkRegistration(contract, deps);
    const status = Number(Object.keys(contract.responses)[0]);
    const hasBody = contract.responses[status] !== null;
    const errorHandler: RouteOptions['errorHandler'] =
      contract.audience === 'public' && contract.params !== undefined
        ? missingForBadParams
        : undefined;

    app.route<RouteGenericInterface, RouteConfig>({
      method: contract.method,
      url: contract.path,
      config: { contract, [FROM_CONTRACT]: true },
      schema: schemaFor(contract, status),
      bodyLimit,
      errorHandler,
      // Before the body is read, so a caller who may not use the route gets nothing from it.
      onRequest: async (request) => {
        const read =
          contract.audience === 'public'
            ? { app: null, session: null }
            : await deps.readSession(request);
        const ignoreSession = contract.audience === 'auth' && contract.session === 'none';
        const context: RequestContext = {
          requestId: request.id,
          app: read.app,
          session: ignoreSession ? null : read.session,
        };
        checkSession(contract, context);
        contexts.set(request, context);
      },
      preValidation: (request, _reply, done) => {
        if (contract.body === undefined && request.body !== undefined) {
          done(new ApiError(400, 'This request takes no body.', { reason: 'unexpected_body' }));
          return;
        }
        done();
      },
      handler: async (request, reply) => {
        const context = contexts.get(request);
        if (context === undefined) throw new Error('The request reached its handler unchecked.');
        // Only what the contract declares: the schema validated nothing else.
        const input: ScopeInput = {
          params: contract.params === undefined ? undefined : request.params,
          query: contract.query === undefined ? undefined : request.query,
          body: contract.body === undefined ? undefined : request.body,
        };

        let body: unknown;
        if (contract.audience === 'console' || contract.audience === 'portal') {
          body = await asMember(
            deps.inTenant,
            { route: contract, context, input, resolvers: deps.resolvers },
            (tx, caller) => handler({ tx, context: caller, input }),
          );
        } else {
          body = await handler({ context, input });
        }
        reply.code(status);
        const rawTypes = contract.responses[status];
        if (isRawBody(rawTypes)) {
          const { type, body: bytes, headers } = body as RawReply;
          if (!(rawTypes.raw as readonly string[]).includes(type)) {
            throw new Error('A handler answered a content type its contract does not name.');
          }
          // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write -- the bytes of a stylesheet built from validated tokens or of a logo checked on upload, with nosniff and a CSP of default-src 'none'
          return reply
            .headers(headers ?? {})
            .type(withCharset(type))
            .send(bytes);
        }
        // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write -- JSON encoded through the contract schema; the API's CSP is default-src 'none'
        return hasBody ? reply.send(body) : reply.send();
      },
    });
  }
}
