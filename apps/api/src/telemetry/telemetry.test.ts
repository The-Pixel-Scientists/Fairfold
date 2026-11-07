// SPDX-License-Identifier: AGPL-3.0-or-later

import { createServer as createHttpServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';

import { AggregationTemporality, InMemoryMetricExporter } from '@opentelemetry/sdk-metrics';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { captureLogs } from '../../test/support.ts';
import { buildApp } from '../app.ts';
import { Secret } from '../config.ts';
import { createLogger } from '../logger.ts';
import { createServer } from '../server.ts';
import { ALLOWED_ATTRIBUTES } from './allowlist.ts';
import {
  recordJobFailure,
  recordMfaFailure,
  recordRateLimitHit,
  setOldestAuditCopyProvider,
  setQueueStatsProvider,
} from './instruments.ts';
import { registerTelemetry } from './plugin.ts';
import { startTelemetry, type Telemetry } from './sdk.ts';
import { telemetryOff } from './settings.ts';

vi.setConfig({ testTimeout: 15_000 });

const EMAIL = 'jo.bloggs@example.org';
const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const NAME = 'Josephine';
const FORWARDED = '203.0.113.77';
const PERSONAL = [
  EMAIL,
  UUID,
  NAME,
  'cookie-secret-value',
  'bearer-secret-value',
  FORWARDED,
  'Mozilla',
  'leaky',
];

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

function inMemory() {
  const spans = new InMemorySpanExporter();
  const metrics = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const telemetry = startTelemetry({
    service: 'api',
    settings: { ...telemetryOff, environment: 'test' },
    exporters: { spans, metrics },
  });
  cleanup.push(() => telemetry.shutdown());
  return { telemetry, spans, metrics };
}

async function exported(
  telemetry: Telemetry,
  spans: InMemorySpanExporter,
  metrics: InMemoryMetricExporter,
) {
  await telemetry.flush();
  return { spans: spans.getFinishedSpans(), metrics: metrics.getMetrics() };
}

type Exported = Awaited<ReturnType<typeof exported>>;

const metricsOf = (out: Exported) =>
  out.metrics.flatMap((batch) => batch.scopeMetrics.flatMap((scope) => scope.metrics));

function attributesOf(out: Exported): Array<Record<string, unknown>> {
  return [
    ...out.spans.map((span) => span.attributes),
    ...metricsOf(out).flatMap((metric) =>
      metric.dataPoints.map((point) => point.attributes as Record<string, unknown>),
    ),
  ];
}

function everything(out: Exported): string {
  return JSON.stringify([
    out.spans.map((span) => [span.name, span.status, span.attributes, span.events]),
    out.spans.map((span) => span.resource.attributes),
    out.metrics.map((batch) => [batch.resource.attributes, batch.scopeMetrics]),
  ]);
}

describe('telemetry while off', () => {
  it('starts nothing and leaves the API as it was', async () => {
    const telemetry = startTelemetry({ service: 'api', settings: telemetryOff });
    expect(telemetry.enabled).toBe(false);
    recordJobFailure({ queue: 'notify', code: 'x' });
    recordMfaFailure({ app: 'portal', factor: 'totp' });
    const app = await buildApp({
      logger: createLogger({ level: 'silent' }),
      checkDatabase: () => Promise.resolve(),
      telemetry,
    });
    cleanup.push(() => app.close());
    expect((await app.inject({ url: '/health' })).statusCode).toBe(200);
    await telemetry.shutdown();
  });
});

describe('telemetry for requests', () => {
  it('records one server span and the metrics, with no personal data', async () => {
    const { telemetry, spans, metrics } = inMemory();
    const app = await buildApp({
      logger: createLogger({ level: 'silent' }),
      checkDatabase: () => Promise.resolve(),
      telemetry,
    });
    cleanup.push(() => app.close());
    const headers = {
      cookie: 'session=cookie-secret-value',
      authorization: 'Bearer bearer-secret-value',
      'x-forwarded-for': FORWARDED,
      'user-agent': 'Mozilla/5.0',
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    };
    await app.inject({ url: '/health', headers });
    await app.inject({
      method: 'POST',
      url: `/api/v1/people/${EMAIL}/${UUID}?name=${NAME}&email=${EMAIL}`,
      headers,
      payload: { name: NAME, email: EMAIL },
    });

    const out = await exported(telemetry, spans, metrics);
    expect(out.spans.map((span) => span.name).sort()).toEqual(['GET /health', 'POST unmatched']);
    for (const span of out.spans) {
      expect(span.parentSpanContext).toBeUndefined();
      expect(span.spanContext().traceId).not.toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    }
    expect(metricsOf(out).map((metric) => metric.descriptor.name)).toEqual(
      expect.arrayContaining(['http.server.request.duration', 'tps.http.server.errors']),
    );
    for (const value of PERSONAL) expect(everything(out)).not.toContain(value);
    for (const attributes of attributesOf(out)) {
      for (const key of Object.keys(attributes)) expect(ALLOWED_ATTRIBUTES).toContain(key);
    }
    expect(out.spans[0]?.resource.attributes['service.name']).toBe('tps-api');
  });

  it('records a failed request by status and problem type, not by its error', async () => {
    const { telemetry, spans, metrics } = inMemory();
    const app: FastifyInstance = createServer(createLogger({ level: 'silent' }));
    registerTelemetry(app, telemetry);
    app.get('/boom', () => {
      throw new Error(`leaky ${EMAIL} ${NAME}`);
    });
    cleanup.push(() => app.close());
    expect((await app.inject({ url: '/boom' })).statusCode).toBe(500);

    const out = await exported(telemetry, spans, metrics);
    expect(out.spans[0]?.attributes).toMatchObject({
      'http.route': '/boom',
      'tps.problem_type': 'server_error',
    });
    expect(out.spans[0]?.status.code).toBe(2);
    expect(out.spans[0]?.events).toEqual([]);
    for (const value of PERSONAL) expect(everything(out)).not.toContain(value);
  });
});

describe('the metric hooks', () => {
  it('count with closed labels and feed the gauges from providers', async () => {
    const { telemetry, spans, metrics } = inMemory();
    recordJobFailure({ queue: 'notify', code: 'smtp_down' });
    recordJobFailure({ queue: `Bad ${EMAIL}`, code: `with ${NAME}` });
    recordRateLimitHit({ limit: 'sign_in', app: 'portal' });
    recordMfaFailure({ app: 'console', factor: 'totp' });
    setQueueStatsProvider(() => [{ queue: 'notify', depth: 3, deadLetters: 1 }]);
    setOldestAuditCopyProvider(() => 42);
    cleanup.push(() => {
      setQueueStatsProvider(undefined);
      setOldestAuditCopyProvider(undefined);
      return Promise.resolve();
    });

    const out = await exported(telemetry, spans, metrics);
    const byName = new Map(metricsOf(out).map((metric) => [metric.descriptor.name, metric]));
    expect(byName.get('tps.job.failures')?.dataPoints.map((point) => point.attributes)).toEqual([
      { 'tps.queue': 'notify', 'tps.error_code': 'smtp_down' },
      { 'tps.queue': 'other', 'tps.error_code': 'unknown' },
    ]);
    expect(byName.get('tps.rate_limit.hits')?.dataPoints[0]?.attributes).toEqual({
      'tps.rate_limit': 'sign_in',
      'tps.app': 'portal',
    });
    expect(byName.get('tps.mfa.failures')?.dataPoints[0]?.attributes).toEqual({
      'tps.app': 'console',
      'tps.mfa_factor': 'totp',
    });
    expect(byName.get('tps.queue.depth')?.dataPoints[0]?.value).toBe(3);
    expect(byName.get('tps.queue.dead_letters')?.dataPoints[0]?.value).toBe(1);
    expect(byName.get('tps.auth_audit_copy.oldest_pending')?.dataPoints[0]?.value).toBe(42);
  });
});

describe('export to a collector', () => {
  it('goes to the configured endpoint with the configured headers', async () => {
    const seen: Array<{ url: string; headers: IncomingHttpHeaders }> = [];
    const collector = createHttpServer((request, response) => {
      request.resume();
      request.on('end', () => {
        seen.push({ url: request.url ?? '', headers: request.headers });
        response.statusCode = 200;
        response.end('{}');
      });
    });
    await new Promise<void>((resolve) => collector.listen(0, '127.0.0.1', resolve));
    cleanup.push(
      () =>
        new Promise((resolve) => {
          collector.close(() => {
            resolve();
          });
        }),
    );
    const { port } = collector.address() as AddressInfo;

    const telemetry = startTelemetry({
      service: 'worker',
      settings: {
        endpoint: new URL(`http://127.0.0.1:${String(port)}/otlp`),
        headers: new Secret('Authorization=Bearer abc123'),
        environment: 'test',
      },
    });
    const app: FastifyInstance = createServer(createLogger({ level: 'silent' }));
    registerTelemetry(app, telemetry);
    app.get('/ping', () => ({ ok: true }));
    cleanup.push(() => app.close());
    await app.inject({ url: '/ping' });
    await telemetry.shutdown();

    expect(seen.map((request) => request.url).sort()).toEqual([
      '/otlp/v1/metrics',
      '/otlp/v1/traces',
    ]);
    for (const request of seen) expect(request.headers['authorization']).toBe('Bearer abc123');
  });

  it('does not fail requests or log the header value when the endpoint is unreachable', async () => {
    const logs = captureLogs();
    const stderr = vi.spyOn(process.stderr, 'write');
    const telemetry = startTelemetry({
      service: 'api',
      settings: {
        endpoint: new URL('http://127.0.0.1:1'),
        headers: new Secret('Authorization=Bearer topsecret999'),
        environment: 'test',
      },
    });
    const app = await buildApp({
      logger: createLogger({ level: 'debug', destination: logs.stream }),
      checkDatabase: () => Promise.resolve(),
      telemetry,
    });
    cleanup.push(() => app.close());
    expect((await app.inject({ url: '/health' })).statusCode).toBe(200);
    await telemetry.shutdown();

    expect(logs.text()).not.toContain('topsecret999');
    expect(stderr.mock.calls.flat().join()).not.toContain('topsecret999');
    stderr.mockRestore();
  });
});
