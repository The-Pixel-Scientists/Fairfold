// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Telemetry for the API and the worker: OTLP traces and metrics, with
// nothing personal in them (see allowlist.ts). The hooks are no-ops while
// telemetry is off.

export { loadTelemetrySettings, telemetryOff, type TelemetrySettings } from './settings.ts';
export { startTelemetry, type StartOptions, type Telemetry } from './sdk.ts';
export { registerTelemetry } from './plugin.ts';
export {
  recordJobFailure,
  recordMfaFailure,
  recordRateLimitHit,
  setOldestAuditCopyProvider,
  setQueueStatsProvider,
  type QueueStat,
} from './instruments.ts';
export { MFA_FACTORS, RATE_LIMITS, type MfaFactor, type RateLimitName } from './allowlist.ts';
