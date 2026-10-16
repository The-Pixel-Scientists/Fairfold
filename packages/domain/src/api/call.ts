// SPDX-License-Identifier: AGPL-3.0-or-later
//
// How the console and portal call the API (ADR 0004): validate the input
// with the route's contract, send it same-origin as JSON, and parse the
// answer with the contract too. Every failure, before or after sending,
// arrives as one ProblemError with words to show and fields to mark. A
// redirect is a failure too: the API never sends one. Routes that answer a
// raw body, such as a stylesheet, are loaded by URL instead, and routes that
// take a file's bytes are sent with upload().

import type { z } from 'zod';

import { fileRefusalMessages } from '../files/messages.ts';
import { encodeFileNameHeader, fileNameHeader, fileNameSchema } from '../files/name.ts';
import {
  fieldForIssue,
  messageForIssue,
  messages,
  type FieldProblem,
} from '../platform/messages.ts';
import { ProblemError, problemSchema } from './problem.ts';
import type { JsonRouteContract, RouteContract, UploadRouteContract } from './route.ts';
import { isRawBody, rawUploadContentType, rawUploadProblems } from './schema-rules.ts';

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

function checkTarget(route: RouteContract, basePath: string): void {
  if (!BASE_PATH.test(basePath)) throw new TypeError('basePath must be a path, such as /api.');
  if (!ROUTE_PATH.test(route.path)) throw new TypeError('A route path starts with its audience.');
  if (Object.values(route.responses).some(isRawBody)) {
    throw new TypeError('call() reads JSON; load a route that answers a raw body by its URL.');
  }
}

/** A success parsed with the route's schema, or a problem as one ProblemError. */
function settle<C extends RouteContract>(route: C, status: number, json: unknown): CallResult<C> {
  if (status >= 200 && status < 300) {
    const schema = route.responses[status];
    if (schema === undefined || isRawBody(schema)) {
      throw new ProblemError(status, messages.serviceFailed);
    }
    if (schema === null) return undefined as CallResult<C>;
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new ProblemError(status, messages.serviceFailed);
    return parsed.data as CallResult<C>;
  }
  const problem = problemSchema.safeParse(json);
  if (problem.success) {
    throw new ProblemError(status, problem.data.detail, {
      requestId: problem.data.requestId,
      errors: problem.data.errors ?? [],
    });
  }
  throw new ProblemError(status, status >= 500 ? messages.serviceFailed : messages.requestFailed);
}

export async function call<const C extends JsonRouteContract>(
  route: C,
  input: CallInput<C>,
  options: CallOptions = {},
): Promise<CallResult<C>> {
  const basePath = options.basePath ?? apiBasePath;
  checkTarget(route, basePath);
  if (isRawBody(route.body)) {
    throw new TypeError('call() sends JSON; send a file to a route that takes one with upload().');
  }
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
  const schema = route.responses[status];
  // No body to read for a declared empty success.
  return settle(route, status, schema === null ? undefined : await readJson(response));
}

/** A file to send. A browser `File` is one. */
export interface UploadFile {
  readonly name: string;
  readonly size: number;
}

/** The part of `XMLHttpRequest` upload() uses, so the package needs no DOM types. */
export interface UploadRequest {
  open(method: string, url: string): void;
  setRequestHeader(name: string, value: string): void;
  send(body: UploadFile): void;
  abort(): void;
  readonly status: number;
  readonly responseText: string;
  readonly responseURL: string;
  readonly upload: { onprogress: ((event: { loaded: number }) => void) | null };
  onload: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
}

/** The part of `AbortSignal` upload() uses. */
export interface UploadSignal {
  readonly aborted: boolean;
  readonly reason: unknown;
  addEventListener(type: 'abort', listener: () => void): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

export interface UploadOptions {
  /** Where the API is on this origin, as for call(). */
  basePath?: string;
  /** Aborting rejects with the signal's reason. */
  signal?: UploadSignal;
  /** Bytes sent so far, of the file's size. */
  onProgress?: (sent: number, total: number) => void;
  /** Tests pass their own. */
  request?: () => UploadRequest;
}

export type UploadInput<C extends RouteContract> = Part<'params', C>;

function newRequest(): UploadRequest {
  const { XMLHttpRequest } = globalThis as unknown as { XMLHttpRequest: new () => UploadRequest };
  return new XMLHttpRequest();
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** The signal's reason, which AbortController makes an `AbortError`. */
function abortReason(signal: UploadSignal | undefined): Error {
  const reason = signal?.reason;
  return reason instanceof Error ? reason : new Error('The upload was cancelled.');
}

/** The page's origin, to tell an answer from the API from one after a redirect. Empty outside a browser. */
function pageOrigin(): string {
  return (globalThis as { location?: { origin?: string } }).location?.origin ?? '';
}

/**
 * Sends a file's bytes to a route with a raw upload body (ADR 0047):
 * same-origin, as `application/octet-stream`, with the trimmed name
 * percent-encoded in the `File-Name` header. It uses XMLHttpRequest because
 * fetch cannot report upload progress. The answer and every failure are
 * handled as call() handles them. The server checks the file again, and
 * finds its type from its bytes.
 */
export async function upload<const C extends UploadRouteContract>(
  route: C,
  input: UploadInput<C>,
  file: UploadFile,
  options: UploadOptions = {},
): Promise<CallResult<C>> {
  const basePath = options.basePath ?? apiBasePath;
  checkTarget(route, basePath);
  if (
    !isRawBody(route.body) ||
    rawUploadProblems(route.body).length > 0 ||
    route.query !== undefined
  ) {
    throw new TypeError('upload() sends a file to a route with a raw upload body and no query.');
  }
  const errors: FieldProblem[] = [];
  const params = parsePart('params', route.params, (input as { params?: unknown }).params, errors);
  if (errors.length > 0) throw new ProblemError(400, messages.fixFields, { errors });
  const name = fileNameSchema.safeParse(file.name);
  if (!name.success) {
    throw new ProblemError(400, messageForIssue(name.error.issues[0] ?? {}));
  }
  if (file.size > route.body.maxBytes) throw new ProblemError(400, fileRefusalMessages.too_large);

  const url = `${basePath}${fillPath(route.path, params)}`;
  const { signal, onProgress } = options;
  if (signal?.aborted === true) throw abortReason(signal);

  return new Promise((resolve, reject) => {
    const request = (options.request ?? newRequest)();
    const abort = () => {
      request.abort();
    };
    const fail = (error: Error) => {
      signal?.removeEventListener('abort', abort);
      reject(error);
    };
    request.upload.onprogress = (event) => {
      onProgress?.(Math.min(event.loaded, file.size), file.size);
    };
    request.onload = () => {
      // XMLHttpRequest follows redirects, and the API never sends one.
      if (request.responseURL !== `${pageOrigin()}${url}`) {
        fail(new ProblemError(0, messages.noConnection));
        return;
      }
      try {
        const result = settle(route, request.status, parseJson(request.responseText));
        signal?.removeEventListener('abort', abort);
        resolve(result);
      } catch (error) {
        fail(error as ProblemError);
      }
    };
    request.onerror = () => {
      fail(new ProblemError(0, messages.noConnection));
    };
    request.onabort = () => {
      fail(abortReason(signal));
    };
    signal?.addEventListener('abort', abort);
    request.open(route.method, url);
    request.setRequestHeader('accept', 'application/json');
    request.setRequestHeader('content-type', rawUploadContentType);
    request.setRequestHeader(fileNameHeader, encodeFileNameHeader(name.data));
    request.send(file);
  });
}
