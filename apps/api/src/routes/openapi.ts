// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Publishes the OpenAPI document, built from the route schemas as they are
// registered (ADR 0004). The same document is committed as
// apps/api/openapi.json, and a test fails when the two differ.

import type { FastifyPluginCallback } from 'fastify';

export const openApiRoutes: FastifyPluginCallback = (app, _options, done) => {
  app.get('/openapi.json', { schema: { hide: true } }, () => app.swagger());
  done();
};
