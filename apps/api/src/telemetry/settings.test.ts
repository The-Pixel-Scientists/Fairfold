// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { ConfigError } from '../config.ts';
import { loadTelemetrySettings, parseHeaders } from './settings.ts';

function problemsOf(env: Record<string, string>): string[] {
  try {
    loadTelemetrySettings(env);
  } catch (error) {
    if (error instanceof ConfigError) return [...error.problems];
    throw error;
  }
  return [];
}

describe('telemetry settings', () => {
  it('are off when no endpoint is set, whatever OTEL_* says', () => {
    const settings = loadTelemetrySettings({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://other.example.org',
    });
    expect(settings.endpoint).toBeUndefined();
    expect(settings.environment).toBe('production');
  });

  it('accept https, a loopback http address, and http with TPS_DEV=1', () => {
    expect(
      loadTelemetrySettings({ TPS_OTEL_ENDPOINT: 'https://c.example.org/otlp' }).endpoint?.href,
    ).toBe('https://c.example.org/otlp');
    expect(problemsOf({ TPS_OTEL_ENDPOINT: 'http://127.0.0.1:4318' })).toEqual([]);
    expect(problemsOf({ TPS_OTEL_ENDPOINT: 'http://c.example.org', TPS_DEV: '1' })).toEqual([]);
    expect(
      loadTelemetrySettings({ TPS_OTEL_ENDPOINT: 'http://127.0.0.1:4318', TPS_DEV: '1' })
        .environment,
    ).toBe('development');
  });

  it('refuse plain http to another host, a login and a query', () => {
    expect(problemsOf({ TPS_OTEL_ENDPOINT: 'http://c.example.org' })[0]).toContain('https');
    expect(problemsOf({ TPS_OTEL_ENDPOINT: 'https://user:pw@c.example.org' })).toHaveLength(1);
    expect(problemsOf({ TPS_OTEL_ENDPOINT: 'https://c.example.org/?a=b' })).toHaveLength(1);
    expect(problemsOf({ TPS_OTEL_ENDPOINT: 'not a url' })).toHaveLength(1);
  });

  it('read the headers from the variable or a file, and never print them', () => {
    const secret = 'Bearer s3cret-value';
    const base = { TPS_OTEL_ENDPOINT: 'https://c.example.org' };
    const fromEnv = loadTelemetrySettings({ ...base, TPS_OTEL_HEADERS: `Authorization=${secret}` });
    expect(parseHeaders(fromEnv.headers?.reveal() ?? '')).toEqual({ Authorization: secret });
    const fromFile = loadTelemetrySettings(
      { ...base, TPS_OTEL_HEADERS_FILE: '/run/secrets/otel' },
      () => `Authorization=${secret}\n`,
    );
    expect(fromFile.headers?.reveal()).toBe(`Authorization=${secret}`);
    expect(JSON.stringify(fromFile)).not.toContain('s3cret');

    const bad = problemsOf({ ...base, TPS_OTEL_HEADERS: `no-equals-${secret}` });
    expect(bad).toEqual(['TPS_OTEL_HEADERS must be Name=value pairs separated by commas.']);
    expect(bad.join()).not.toContain('s3cret');
  });

  it('refuse headers without an endpoint, and report every problem together', () => {
    expect(problemsOf({ TPS_OTEL_HEADERS: 'A=b' })).toEqual([
      'TPS_OTEL_HEADERS is used only with TPS_OTEL_ENDPOINT.',
    ]);
    expect(
      problemsOf({
        TPS_OTEL_ENDPOINT: 'ftp://x',
        TPS_OTEL_HEADERS: 'bad',
        TPS_OTEL_ENVIRONMENT: 'X',
      }),
    ).toHaveLength(3);
  });
});
