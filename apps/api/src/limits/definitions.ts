// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The request limits (S11-36): fixed constants, with no setting to turn one
// off and no override for a tenant. Every window is fixed, and starts on a
// multiple of its length on the database's clock, so API instances share it.
// A refused key is remembered by each instance until its window ends, and
// refused again without a counter call, so a client that keeps trying stays
// refused and costs the database nothing.
//
// `bucket` is the value of app.request_limit.bucket (migration 0017). The
// buckets are public, probe and general, and the four upload counters
// (ADR 0030); the limits that share one are told
// apart by the name inside the key, so their counters never meet.

import { uploadBuckets, uploadLimits } from '@pixel-scientists/domain/files';

import type { RateLimitName } from '../telemetry/index.ts';

export const BUCKETS = ['public', 'probe', 'general', ...uploadBuckets] as const;
export type Bucket = (typeof BUCKETS)[number];

export interface Limit {
  readonly bucket: Bucket;
  readonly windowSeconds: number;
  readonly max: number;
  /** The name the rate-limit metric uses, from telemetry's closed list. */
  readonly metric: RateLimitName;
}

const limits = {
  // A portal page makes about three public requests, so 40 page loads a
  // minute from one address, with room for an office behind one address.
  public: { bucket: 'public', windowSeconds: 60, max: 120, metric: 'public' },
  // Platform probes come every 5 to 10 seconds, from a few addresses.
  probe: { bucket: 'probe', windowSeconds: 60, max: 60, metric: 'api' },
  // The document is large and read by people and tools, not on every page.
  openapi: { bucket: 'probe', windowSeconds: 60, max: 30, metric: 'api' },
  // 20 requests a second from one address: a busy office, not a script.
  general_ip: { bucket: 'general', windowSeconds: 60, max: 1200, metric: 'api' },
  // 5 requests a second from one signed-in user: a screen makes about ten.
  general_session: { bucket: 'general', windowSeconds: 60, max: 300, metric: 'api' },
} as const satisfies Record<string, Limit>;

/** The four upload counters (ADR 0030); their limits are the domain's. */
const uploads = Object.fromEntries(
  uploadBuckets.map((bucket) => [
    bucket,
    {
      bucket,
      windowSeconds: uploadLimits[bucket].windowSeconds,
      max: uploadLimits[bucket].max,
      metric: 'api',
    },
  ]),
) as Record<(typeof uploadBuckets)[number], Limit>;

export const LIMITS = { ...limits, ...uploads } as const;

export type LimitName = keyof typeof LIMITS;
