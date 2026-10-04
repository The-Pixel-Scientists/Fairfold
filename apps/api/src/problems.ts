// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Error responses as problem details (RFC 9457, ADR 0004). Every error the API
// sends has the same shape and carries the request id, so a person can quote it
// and support can find the log lines.
//
// What a response never holds: a stack trace, the message of an unexpected
// error, a submitted value, a constraint name or any other database detail.
// The text comes from this file, from an ApiError thrown on purpose, or from
// the domain package's message catalogue. Everything else gets the generic
// text for its status.

import { STATUS_CODES } from 'node:http';

import { problemSchema, type Problem } from '@pixel-scientists/domain/api';
import { messages } from '@pixel-scientists/domain/platform';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { setResponseHeaders } from './headers.ts';
import { SafeError } from './serialize-error.ts';
import {
  fieldProblems,
  MAX_FIELD_PROBLEMS,
  type FieldProblem,
  type ValidationEntry,
} from './validation-problems.ts';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json; charset=utf-8';

export { problemSchema, type Problem };

/**
 * An error whose text is safe to show and to log. Throw it for a failure the
 * caller can understand and act on. Anything else that is thrown reaches the
 * caller as the generic text for its status.
 */
export class ApiError extends SafeError {
  readonly status: number;
  readonly detail: string;
  readonly errors: readonly FieldProblem[];
  /** Why a request was refused, as a code for the log. Never sent. */
  readonly reason: string | undefined;

  /** With no `detail`, the plain text for the status. */
  constructor(
    status: number,
    detail?: string,
    options: { errors?: readonly FieldProblem[]; cause?: unknown; reason?: string } = {},
  ) {
    const text = detail ?? detailFor(status, undefined);
    super(text, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ApiError';
    this.status = status;
    this.detail = text;
    this.errors = options.errors ?? [];
    this.reason = options.reason;
  }
}

const SERVER_ERROR_DETAIL =
  'Something went wrong on our side. Try again in a few minutes. If it keeps happening, give support the request id.';

const NOT_FOUND_DETAIL = 'We could not find what you asked for.';

/** Plain English for each status. A 404 reads the same whether or not the thing exists. */
const DETAIL_BY_STATUS = new Map<number, string>([
  [400, 'We could not read the request. Check it and try again.'],
  [401, 'Sign in to continue.'],
  [403, 'You do not have permission to do this.'],
  [404, NOT_FOUND_DETAIL],
  [405, 'This request method is not allowed here.'],
  [406, 'We cannot send a response in the format you asked for.'],
  [408, 'The request took too long to arrive. Try again.'],
  [409, 'This conflicts with the current state. Reload and try again.'],
  [410, 'This is no longer available.'],
  [413, 'The request is too large.'],
  [414, 'The web address is too long.'],
  [415, 'Send the request as JSON, with the content type application/json.'],
  [422, 'We could not process the request. Check it and try again.'],
  [429, 'There have been too many requests. Wait a moment and try again.'],
  [503, 'The service is not available right now. Try again in a few minutes.'],
]);

/** Fastify's own errors, where the status alone says too little. */
const DETAIL_BY_CODE = new Map<string, string>([
  ['FST_ERR_CTP_EMPTY_JSON_BODY', 'Send a body of valid JSON.'],
  ['FST_ERR_CTP_INVALID_JSON_BODY', 'The body is not valid JSON. Check it and try again.'],
  [
    'FST_ERR_CTP_INVALID_MEDIA_TYPE',
    'Send the request as JSON, with the content type application/json.',
  ],
  ['FST_ERR_CTP_BODY_TOO_LARGE', 'The request body is too large.'],
]);

function detailFor(status: number, code: string | undefined): string {
  const byCode = code === undefined ? undefined : DETAIL_BY_CODE.get(code);
  if (byCode !== undefined) return byCode;
  const byStatus = DETAIL_BY_STATUS.get(status);
  if (byStatus !== undefined) return byStatus;
  return status >= 500 ? SERVER_ERROR_DETAIL : 'We could not complete the request.';
}

interface Failure {
  status: number;
  detail: string;
  errors: readonly FieldProblem[];
  /** Whether the error was unexpected, so it needs a log line with its stack. */
  unexpected: boolean;
  reason?: string;
}

function statusOf(error: object): number | undefined {
  const status = (error as { statusCode?: unknown }).statusCode;
  return typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599
    ? status
    : undefined;
}

function describe(error: unknown): Failure {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      detail: error.detail,
      errors: error.errors.slice(0, MAX_FIELD_PROBLEMS),
      unexpected: error.status >= 500,
      ...(error.reason === undefined ? {} : { reason: error.reason }),
    };
  }
  if (typeof error !== 'object' || error === null) {
    return { status: 500, detail: SERVER_ERROR_DETAIL, errors: [], unexpected: true };
  }

  const code = (error as { code?: unknown }).code;
  const validation = (error as { validation?: unknown }).validation;
  if (Array.isArray(validation)) {
    const context = (error as { validationContext?: unknown }).validationContext;
    return {
      status: 400,
      detail: messages.fixFields,
      errors: fieldProblems(
        validation as ValidationEntry[],
        typeof context === 'string' ? context : undefined,
      ),
      unexpected: false,
    };
  }

  // Includes a response that does not match its schema, which is status 500.
  const status = statusOf(error) ?? 500;
  return {
    status,
    detail: detailFor(status, typeof code === 'string' ? code : undefined),
    errors: [],
    unexpected: status >= 500,
  };
}

export function sendProblem(
  request: FastifyRequest,
  reply: FastifyReply,
  status: number,
  detail: string,
  errors: readonly FieldProblem[] = [],
): FastifyReply {
  const problem: Problem = {
    type: 'about:blank',
    title: STATUS_CODES[status] ?? 'Error',
    status,
    detail,
    requestId: request.id,
    ...(errors.length > 0 ? { errors: [...errors] } : {}),
  };
  // Sent as text, so a response schema declared on the route cannot reshape it.
  setResponseHeaders(request, reply);
  return reply
    .code(status)
    .header('content-type', PROBLEM_CONTENT_TYPE)
    .send(JSON.stringify(problem));
}

/** Fastify's error handler: every thrown error becomes a problem. */
export function handleError(error: unknown, request: FastifyRequest, reply: FastifyReply): void {
  const failure = describe(error);
  if (failure.unexpected) {
    request.log.error({ err: error }, 'The request failed');
  } else {
    request.log.info(
      {
        status: failure.status,
        ...(failure.reason === undefined ? {} : { reason: failure.reason }),
      },
      'The request was refused',
    );
  }
  if (reply.raw.headersSent) {
    // Too late to change the response; the connection ends as it is.
    return;
  }
  sendProblem(request, reply, failure.status, failure.detail, failure.errors);
}

/** An unknown route reads like any other error. */
export function handleNotFound(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return sendProblem(request, reply, 404, NOT_FOUND_DETAIL);
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler(handleError);
  app.setNotFoundHandler(handleNotFound);
}
