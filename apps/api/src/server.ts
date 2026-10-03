// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Fastify instance every route is registered on: request ids, Zod
// validation of requests, Zod encoding of responses and problem-details
// errors. Routes and the OpenAPI document are added in app.ts.

import { randomUUID } from 'node:crypto';

import { fastify, LogController, type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';

import { handleError, registerErrorHandling } from './problems.ts';

export function createServer(logger: FastifyBaseLogger): FastifyInstance {
  const app = fastify({
    loggerInstance: logger,
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
    reply.header('x-request-id', request.id);
    done();
  });
  return app;
}
