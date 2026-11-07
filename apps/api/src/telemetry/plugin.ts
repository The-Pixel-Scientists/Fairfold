// SPDX-License-Identifier: AGPL-3.0-or-later
//
// One server span and the request metrics for each request. The only labels
// are the method, the matched route's template (`unmatched` when no route
// matched), the status code, the app and the module id; the allowlist drops
// anything else. A trace always starts here, whatever the client sent, and a
// failed request records only a fixed problem type, never the error.

import { SpanKind, SpanStatusCode, type Span } from '@opentelemetry/api';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { allowedAttributes } from './allowlist.ts';
import type { Telemetry } from './sdk.ts';

const PROBLEM_TYPES = new Map<number, string>([
  [400, 'validation'],
  [401, 'unauthenticated'],
  [403, 'forbidden'],
  [404, 'not_found'],
  [405, 'method_not_allowed'],
  [409, 'conflict'],
  [413, 'payload_too_large'],
  [415, 'unsupported_media_type'],
  [429, 'too_many_requests'],
]);

/** A fixed name for a failing status, so the error counter has no free text. */
export function problemType(status: number): string {
  return status >= 500 ? 'server_error' : (PROBLEM_TYPES.get(status) ?? 'client_error');
}

interface Started {
  readonly span: Span;
  readonly startedAt: bigint;
}

function requestLabels(request: FastifyRequest) {
  const contract = (request.routeOptions.config as { contract?: unknown } | undefined)?.contract as
    { audience?: unknown; module?: unknown } | undefined;
  const audience = contract?.audience;
  return {
    'http.request.method': request.method,
    'http.route': request.routeOptions.url ?? 'unmatched',
    'tps.app': audience === 'console' || audience === 'portal' ? audience : 'none',
    'tps.module': contract?.module ?? 'none',
  };
}

/** Add the hooks to the whole app, not just a child scope. */
export function registerTelemetry(app: FastifyInstance, telemetry: Telemetry): void {
  const { tracer, instruments } = telemetry;
  if (tracer === undefined || instruments === undefined) return;
  const started = new WeakMap<FastifyRequest, Started>();

  app.addHook('onRequest', (request, _reply, done) => {
    const labels = requestLabels(request);
    const span = tracer.startSpan(`${labels['http.request.method']} ${labels['http.route']}`, {
      kind: SpanKind.SERVER,
      root: true,
      attributes: allowedAttributes(labels),
    });
    started.set(request, { span, startedAt: process.hrtime.bigint() });
    done();
  });

  app.addHook('onResponse', (request, reply, done) => {
    const entry = started.get(request);
    if (entry !== undefined) {
      started.delete(request);
      const status = reply.statusCode;
      const labels = { ...requestLabels(request), 'http.response.status_code': status };
      const seconds = Number(process.hrtime.bigint() - entry.startedAt) / 1e9;
      instruments.requestDuration.record(seconds, allowedAttributes(labels));
      entry.span.setAttributes(allowedAttributes(labels));
      if (status >= 400) {
        const type = problemType(status);
        instruments.requestErrors.add(
          1,
          allowedAttributes({ ...labels, 'tps.problem_type': type }),
        );
        entry.span.setAttribute('tps.problem_type', type);
        if (status >= 500) entry.span.setStatus({ code: SpanStatusCode.ERROR });
      }
      entry.span.end();
    }
    done();
  });
}
