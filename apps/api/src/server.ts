// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Fastify instance every route is registered on: request ids, response
// headers (ADR 0006), a body limit, Zod validation of requests, Zod encoding
// of responses and problem-details errors. Routes and the OpenAPI document
// are added in app.ts.

import { randomUUID } from 'node:crypto';

import { fastify, LogController, type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';

import { setResponseHeaders } from './headers.ts';
import { handleError, registerErrorHandling } from './problems.ts';

/** The largest request body. JSON bodies here are small, and the biggest is a 200 KB logo. */
export const BODY_LIMIT_BYTES = 1_048_576;

export interface ServerOptions {
  /** Addresses or ranges of the reverse proxies whose forwarded headers are believed. None by default. */
  trustProxy?: readonly string[];
}

export function createServer(
  logger: FastifyBaseLogger,
  options: ServerOptions = {},
): FastifyInstance {
  const trusted = options.trustProxy ?? [];
  const app = fastify({
    loggerInstance: logger,
    bodyLimit: BODY_LIMIT_BYTES,
    // Only the listed proxies may say what the client's address and protocol are.
    trustProxy: trusted.length === 0 ? false : [...trusted],
    // Every request gets a new id here. A caller-supplied id is never trusted,
    // because audit events and job payloads carry the request id.
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    logController: new LogController({ requestIdLogLabel: 'requestId' }),
    // Errors raised before a route runs, such as a malformed URL, get the same answer as any other.
    frameworkErrors: handleError,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  // Bodies are JSON only: a text/plain request gets a 415 like any other content type.
  app.removeContentTypeParser('text/plain');
  registerErrorHandling(app);

  app.addHook('onRequest', (request, reply, done) => {
    setResponseHeaders(request, reply);
    done();
  });
  return app;
}
