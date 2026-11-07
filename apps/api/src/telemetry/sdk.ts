// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Starts and stops the OpenTelemetry providers. They are built directly, with
// explicit options: no environment auto-configuration (so the OTEL_* variables
// change nothing), no resource detectors, no global provider and no
// propagator, so inbound trace context is ignored and none is sent out.
// Export failures are never logged: the library's diagnostics stay silent.

import type { Tracer } from '@opentelemetry/api';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  MeterProvider,
  PeriodicExportingMetricReader,
  type PushMetricExporter,
} from '@opentelemetry/sdk-metrics';
import { BatchSpanProcessor, TracerProvider, type SpanExporter } from '@opentelemetry/sdk-trace';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

import manifest from '../../package.json' with { type: 'json' };
import { createInstruments, releaseInstruments, type Instruments } from './instruments.ts';
import { parseHeaders, type TelemetrySettings } from './settings.ts';

const EXPORT_TIMEOUT_MS = 10_000;
const METRIC_INTERVAL_MS = 30_000;
const SHUTDOWN_LIMIT_MS = 5000;

export interface Telemetry {
  readonly enabled: boolean;
  readonly tracer?: Tracer;
  readonly instruments?: Instruments;
  /** Push what is waiting to the exporters. */
  flush(): Promise<void>;
  /** Flush within a time limit, then stop. Never throws. */
  shutdown(): Promise<void>;
}

export interface StartOptions {
  readonly service: 'api' | 'worker';
  readonly settings: TelemetrySettings;
  /** Replaces the OTLP exporters, for tests. */
  readonly exporters?: { spans: SpanExporter; metrics: PushMetricExporter };
}

const off: Telemetry = {
  enabled: false,
  flush: () => Promise.resolve(),
  shutdown: () => Promise.resolve(),
};

function withLimit(work: Promise<unknown>): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, SHUTDOWN_LIMIT_MS);
  });
  return Promise.race([
    work.then(
      () => undefined,
      () => undefined,
    ),
    limit,
  ]).finally(() => {
    clearTimeout(timer);
  });
}

/** With no endpoint (and no test exporters) nothing starts: no SDK, exporter or timer. */
export function startTelemetry(options: StartOptions): Telemetry {
  const { service, settings } = options;
  const { endpoint } = settings;
  if (endpoint === undefined && options.exporters === undefined) return off;

  const exporters = options.exporters ?? (endpoint === undefined ? undefined : otlp(settings));
  if (exporters === undefined) return off;

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: `tps-${service}`,
    [ATTR_SERVICE_VERSION]: manifest.version,
    'deployment.environment.name': settings.environment,
  });
  const tracerProvider = new TracerProvider({
    resource,
    spanProcessors: [new BatchSpanProcessor({ exporter: exporters.spans })],
  });
  const reader = new PeriodicExportingMetricReader({
    exporter: exporters.metrics,
    exportIntervalMillis: METRIC_INTERVAL_MS,
    exportTimeoutMillis: EXPORT_TIMEOUT_MS,
  });
  const meterProvider = new MeterProvider({ resource, readers: [reader] });
  const instruments = createInstruments(meterProvider.getMeter('tps'));

  return {
    enabled: true,
    tracer: tracerProvider.getTracer('tps'),
    instruments,
    flush: () => withLimit(Promise.all([tracerProvider.forceFlush(), meterProvider.forceFlush()])),
    shutdown: async () => {
      releaseInstruments(instruments);
      await withLimit(Promise.all([tracerProvider.shutdown(), meterProvider.shutdown()]));
    },
  };
}

function otlp(settings: TelemetrySettings): { spans: SpanExporter; metrics: PushMetricExporter } {
  const base = (settings.endpoint?.href ?? '').replace(/\/$/, '');
  const headers = parseHeaders(settings.headers?.reveal() ?? '') ?? {};
  const common = { headers, timeoutMillis: EXPORT_TIMEOUT_MS };
  return {
    spans: new OTLPTraceExporter({ url: `${base}/v1/traces`, ...common }),
    metrics: new OTLPMetricExporter({ url: `${base}/v1/metrics`, ...common }),
  };
}
