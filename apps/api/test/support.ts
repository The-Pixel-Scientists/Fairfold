// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Helpers for the API's tests. The auth module is S02-07's, so the policy's
// tests stand in for it: a header names the session a request carries.

import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';

import type { TenantId } from '@pixel-scientists/db';
import type { App } from '@pixel-scientists/domain/platform';
import type { LightMyRequestResponse } from 'fastify';
import { expect } from 'vitest';

import type { AuthModule, MfaState, RequestSession, SessionRead } from '../src/context.ts';

/** Mail settings for tests that load the configuration (the db project sets TPS_DEV=1). Nothing connects. */
export const smtpTestSettings = {
  TPS_SMTP_HOST: '127.0.0.1',
  TPS_SMTP_PORT: '51025',
  TPS_SMTP_TLS: 'none',
  TPS_SMTP_FROM: 'grants@example.org',
} as const;

export type LogLine = Record<string, unknown> & { level: string; msg?: string };

/** A log destination that keeps what is written, so a test can read the lines. */
export function captureLogs(): { stream: Writable; lines: () => LogLine[]; text: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  const text = (): string => chunks.join('');
  return {
    stream,
    text,
    lines: () =>
      text()
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as LogLine),
  };
}

/** A tenant id for a test, which no trusted source made. */
export function tenantId(id: string): TenantId {
  return id as TenantId;
}

export interface TestSessionOptions {
  app?: App;
  userId?: string;
  tenant?: string;
  mfa?: MfaState;
  recentAuthAt?: Date | null;
}

/** A signed-in session: a console one with MFA complete unless said otherwise. */
export function testSession(options: TestSessionOptions = {}): RequestSession {
  const app = options.app ?? 'console';
  return {
    userId: options.userId ?? randomUUID(),
    app,
    tenant: tenantId(options.tenant ?? randomUUID()),
    mfa: options.mfa ?? (app === 'console' ? 'complete' : 'not_required'),
    recentAuthAt: options.recentAuthAt ?? null,
    email: () => Promise.resolve('jo@example.org'),
  };
}

const SESSION_HEADER = 'x-test-session';

/** An auth module whose sessions are the ones handed to as(), which returns the headers that carry one. */
export function testAuth(): {
  module: AuthModule;
  as: (read: SessionRead) => Record<string, string>;
} {
  const reads = new Map<string, SessionRead>();
  return {
    module: {
      plugin: () => Promise.resolve(),
      readSession: (request) => {
        const key = request.headers[SESSION_HEADER];
        return Promise.resolve(
          (typeof key === 'string' ? reads.get(key) : undefined) ?? { app: null, session: null },
        );
      },
    },
    as(read) {
      const key = randomUUID();
      reads.set(key, read);
      return { [SESSION_HEADER]: key };
    },
  };
}

/** The entries of `record` except the named keys. */
function without(record: Record<string, unknown>, ...keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)));
}

function withoutRequestId(response: LightMyRequestResponse) {
  return {
    status: response.statusCode,
    problem: without(response.json<Record<string, unknown>>(), 'requestId'),
    headers: without(response.headers, 'x-request-id', 'date'),
  };
}

/**
 * Proves an object outside the caller's scope answers as a missing one does:
 * the same status, words and headers, apart from the request id. Every route
 * test that takes an object's id uses it, with another user's object in the
 * same tenant and an id that exists nowhere.
 */
export function expectLooksMissing(
  outside: LightMyRequestResponse,
  missing: LightMyRequestResponse,
): void {
  expect(missing.statusCode).toBe(404);
  expect(withoutRequestId(outside)).toEqual(withoutRequestId(missing));
}
