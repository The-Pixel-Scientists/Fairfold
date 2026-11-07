// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The metric instruments and the hooks other code calls to feed them. Each
// hook is a no-op while telemetry is off, so callers never branch. Every
// label goes through the allowlist (allowlist.ts), so a value outside its
// closed set is replaced, never exported.

import type { Counter, Histogram, Meter } from '@opentelemetry/api';

import {
  allowedAttributes,
  type MfaFactor,
  type RateLimitName,
  type TelemetryApp,
} from './allowlist.ts';

export interface Instruments {
  readonly requestDuration: Histogram;
  readonly requestErrors: Counter;
  readonly jobFailures: Counter;
  readonly rateLimitHits: Counter;
  readonly mfaFailures: Counter;
}

export interface QueueStat {
  readonly queue: string;
  readonly depth: number;
  readonly deadLetters: number;
}

let current: Instruments | undefined;
let queueStats: (() => readonly QueueStat[] | Promise<readonly QueueStat[]>) | undefined;
let oldestAuditCopy: (() => number | undefined | Promise<number | undefined>) | undefined;

/** Create the instruments on a meter and make them the ones the hooks use. */
export function createInstruments(meter: Meter): Instruments {
  const instruments: Instruments = {
    requestDuration: meter.createHistogram('http.server.request.duration', { unit: 's' }),
    requestErrors: meter.createCounter('tps.http.server.errors'),
    jobFailures: meter.createCounter('tps.job.failures'),
    rateLimitHits: meter.createCounter('tps.rate_limit.hits'),
    mfaFailures: meter.createCounter('tps.mfa.failures'),
  };
  const queueDepth = meter.createObservableGauge('tps.queue.depth');
  const deadLetters = meter.createObservableGauge('tps.queue.dead_letters');
  meter.addBatchObservableCallback(
    async (result) => {
      for (const stat of (await queueStats?.()) ?? []) {
        const attributes = allowedAttributes({ 'tps.queue': stat.queue });
        result.observe(queueDepth, stat.depth, attributes);
        result.observe(deadLetters, stat.deadLetters, attributes);
      }
    },
    [queueDepth, deadLetters],
  );
  const oldest = meter.createObservableGauge('tps.auth_audit_copy.oldest_pending', { unit: 's' });
  meter.addBatchObservableCallback(
    async (result) => {
      const seconds = await oldestAuditCopy?.();
      if (seconds !== undefined) result.observe(oldest, seconds);
    },
    [oldest],
  );
  current = instruments;
  return instruments;
}

/** Forget the instruments, if these are the current ones. */
export function releaseInstruments(instruments: Instruments): void {
  if (current === instruments) current = undefined;
}

/** A job ended in failure. `code` is an error code, never a message. */
export function recordJobFailure(label: { queue: string; code: string }): void {
  current?.jobFailures.add(
    1,
    allowedAttributes({ 'tps.queue': label.queue, 'tps.error_code': label.code }),
  );
}

/** A request was refused by a rate limit. */
export function recordRateLimitHit(label: { limit: RateLimitName; app: TelemetryApp }): void {
  current?.rateLimitHits.add(
    1,
    allowedAttributes({ 'tps.rate_limit': label.limit, 'tps.app': label.app }),
  );
}

/** A second-factor check failed. */
export function recordMfaFailure(label: { app: TelemetryApp; factor: MfaFactor }): void {
  current?.mfaFailures.add(
    1,
    allowedAttributes({ 'tps.app': label.app, 'tps.mfa_factor': label.factor }),
  );
}

/** The worker registers how to read queue depth and dead letters for each queue. */
export function setQueueStatsProvider(provider: typeof queueStats): void {
  queueStats = provider;
}

/** S11-68 registers how to read the age, in seconds, of the oldest pending auth audit copy. */
export function setOldestAuditCopyProvider(provider: typeof oldestAuditCopy): void {
  oldestAuditCopy = provider;
}
