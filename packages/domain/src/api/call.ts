// SPDX-License-Identifier: AGPL-3.0-or-later
//
// How the console and portal call the API (ADR 0004): validate the input
// with the route's contract, send it same-origin as JSON, and parse the
// answer with the contract too. Every failure, before or after sending,
// arrives as one ProblemError with words to show and fields to mark. A
// redirect is a failure too: the API never sends one.

import type { z } from 'zod';

import {
  fieldForIssue,
  messageForIssue,
  messages,
  type FieldProblem,
} from '../platform/messages.ts';
import { ProblemError, problemSchema } from './problem.ts';
import type { RouteContract } from './route.ts';

/** Each app's origin forwards this path to the API. */
export const apiBasePath = '/api';

const BASE_PATH = /^(?:\/[A-Za-z0-9_-]+)*$/;
const ROUTE_PATH = /^\/(?:console|portal|public|auth)\//;

/** The part of `fetch` this file uses, so the package needs no DOM or Node.js types. */
interface FetchInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
  credentials: 'same-origin';
  redirect: 'error';
}

interface FetchResponse {
  readonly status: number;
  json(): Promise<unknown>;
}

export type Fetch = (url: string, init: FetchInit) => Promise<FetchResponse>;

export interface CallOptions {
  /** Tests pass their own. */
  fetch?: Fetch;
  /** Where the API is on this origin, such as `/api`; an empty string for the root. */
  basePath?: string;
}

type Part<K extends 'params' | 'query' | 'body', C> = C extends {
  readonly [P in K]: infer S extends z.ZodType;
}
  ? { readonly [P in K]: z.input<S> }
  : { readonly [P in K]?: never };

export type CallInput<C extends RouteContract> = Part<'params', C> &
  Part<'query', C> &
  Part<'body', C>;

export type CallResult<C extends RouteContract> = {
  [S in keyof C['responses']]: C['responses'][S] extends z.ZodType
    ? z.output<C['responses'][S]>
    : undefined;
}[keyof C['responses']];

function globalFetch(url: string, init: FetchInit): Promise<FetchResponse> {
  return (globalThis as unknown as { fetch: Fetch }).fetch(url, init);
}

function parsePart(
  part: 'params' | 'query' | 'body',
  schema: z.ZodType | undefined,
  value: unknown,
  errors: FieldProblem[],
): unknown {
  if (schema === undefined) return undefined;
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  for (const issue of result.error.issues) {
    errors.push({ field: fieldForIssue(part, issue), message: messageForIssue(issue) });
  }
  return undefined;
}

/** A value for the URL. Contracts allow only these, so anything else is refused, not sent. */
function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  throw new ProblemError(400, messages.requestFailed);
}

/** Path parameters are ids or a slug; an empty or dot segment could change the path, so never. */
function fillPath(path: string, params: unknown): string {
  const values = (params ?? {}) as Record<string, unknown>;
  return path.replace(/:([A-Za-z0-9]+)/g, (_match, name: string) => {
    const value = text(values[name]);
    if (value === '' || value === '.' || value === '..') {
      throw new ProblemError(400, messages.requestFailed);
    }
    return encodeURIComponent(value);
  });
}

function queryString(query: unknown): string {
  const pairs: string[] = [];
  for (const [key, value] of Object.entries((query ?? {}) as Record<string, unknown>)) {
    for (const item of Array.isArray(value) ? (value as unknown[]) : [value]) {
      if (item !== undefined && item !== null) {
        pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(text(item))}`);
      }
    }
  }
  return pairs.length === 0 ? '' : `?${pairs.join('&')}`;
}

async function readJson(response: FetchResponse): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export async function call<const C extends RouteContract>(
  route: C,
  input: CallInput<C>,
  options: CallOptions = {},
): Promise<CallResult<C>> {
  const basePath = options.basePath ?? apiBasePath;
  if (!BASE_PATH.test(basePath)) throw new TypeError('basePath must be a path, such as /api.');
  if (!ROUTE_PATH.test(route.path)) throw new TypeError('A route path starts with its audience.');
  const parts = input as { params?: unknown; query?: unknown; body?: unknown };
  const errors: FieldProblem[] = [];
  const params = parsePart('params', route.params, parts.params, errors);
  const query = parsePart('query', route.query, parts.query, errors);
  const body = parsePart('body', route.body, parts.body, errors);
  if (errors.length > 0) throw new ProblemError(400, messages.fixFields, { errors });

  const init: FetchInit = {
    method: route.method,
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
    redirect: 'error',
  };
  if (route.body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const url = `${basePath}${fillPath(route.path, params)}${queryString(query)}`;

  let response: FetchResponse;
  try {
    response = await (options.fetch ?? globalFetch)(url, init);
  } catch {
    throw new ProblemError(0, messages.noConnection);
  }

  const { status } = response;
  if (status >= 200 && status < 300) {
    const schema = route.responses[status];
    if (schema === undefined) throw new ProblemError(status, messages.serviceFailed);
    if (schema === null) return undefined as CallResult<C>;
    const parsed = schema.safeParse(await readJson(response));
    if (!parsed.success) throw new ProblemError(status, messages.serviceFailed);
    return parsed.data as CallResult<C>;
  }

  const problem = problemSchema.safeParse(await readJson(response));
  if (problem.success) {
    throw new ProblemError(status, problem.data.detail, {
      requestId: problem.data.requestId,
      errors: problem.data.errors ?? [],
    });
  }
  throw new ProblemError(status, status >= 500 ? messages.serviceFailed : messages.requestFailed);
}
