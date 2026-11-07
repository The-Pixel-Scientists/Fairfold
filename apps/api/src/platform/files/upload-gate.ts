// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What a raw upload must pass before its body is read (ADR 0030, "Upload
// limits"), after the session and permission checks:
//
//  1. It declares its length (Content-Length), else 411. The server stops
//     reading at that length, and at the route's limit.
//  2. This process reads at most 16 bodies at once, else 503.
//  3. The declared length is charged to the four upload counters: files and
//     bytes per membership (from the session) and per client address (IPv6
//     by /64). At a limit the answer is 429 with Retry-After, and the
//     counters it had already charged are given back.
//
// The caller gives the charge back when the request turns out to be a replay
// of an idempotent upload. A type or virus refusal keeps its charge.

import {
  MAX_FILE_BYTES,
  MAX_UPLOAD_BODIES_AT_ONCE,
  uploadBuckets,
  uploadCharge,
  uploadLimitMessage,
  uploadLimits,
} from '@pixel-scientists/domain/files';

import type { Secret } from '../../config.ts';
import { clientNetwork, keyHash } from '../../limits/client-key.ts';
import type { UploadCounters } from '../../limits/store.ts';
import { ApiError } from '../../problems.ts';

export interface Admission {
  /** The body has been read (or the request ended): frees this upload's place among the 16. */
  readonly bodyRead: () => void;
  /** Gives the charge back, for a replay. */
  readonly refund: () => Promise<void>;
}

export interface UploadGate {
  admit(
    request: { ip: string; headers: Record<string, unknown> },
    membershipId: string,
    maxBytes?: number,
  ): Promise<Admission>;
}

const RETRY_AFTER = { 'retry-after': '5' } as const;

export function uploadGate(options: { store: UploadCounters; key: Secret }): UploadGate {
  const { store, key } = options;
  let reading = 0;

  return {
    async admit(request, membershipId, maxBytes = MAX_FILE_BYTES) {
      const length = request.headers['content-length'];
      if (typeof length !== 'string' || !/^\d{1,9}$/.test(length)) {
        throw new ApiError(411, 'Send the file with its length in a Content-Length header.', {
          reason: 'length_required',
        });
      }
      // Over the route's limit: refused before anything is charged.
      if (Number(length) > maxBytes) {
        throw new ApiError(413, 'The file is too large.', { reason: 'file_too_large' });
      }
      if (reading >= MAX_UPLOAD_BODIES_AT_ONCE) {
        throw new ApiError(503, 'We are receiving other files. Wait a minute, then try again.', {
          reason: 'uploads_busy',
          headers: RETRY_AFTER,
        });
      }
      reading++;
      let done = false;
      const bodyRead = (): void => {
        if (!done) {
          done = true;
          reading--;
        }
      };

      const charged: { bucket: (typeof uploadBuckets)[number]; hash: Buffer; amount: number }[] =
        [];
      const refund = async (): Promise<void> => {
        await Promise.allSettled(
          charged
            .splice(0)
            .map(({ bucket, hash, amount }) =>
              store.subtract(bucket, hash, uploadLimits[bucket].windowSeconds, amount),
            ),
        );
      };
      try {
        for (const bucket of uploadBuckets) {
          const amount = uploadCharge(bucket, Number(length));
          if (amount === 0) continue;
          const limit = uploadLimits[bucket];
          const subject = limit.key === 'membership' ? membershipId : clientNetwork(request.ip);
          const hash = keyHash(key, bucket, subject);
          const result = await store.add(bucket, hash, limit.windowSeconds, amount, limit.max);
          if (!result.charged) {
            throw new ApiError(429, uploadLimitMessage(result.retryAfter), {
              reason: 'upload_limit',
              headers: { 'retry-after': String(result.retryAfter) },
            });
          }
          charged.push({ bucket, hash, amount });
        }
      } catch (error) {
        bodyRead();
        await refund();
        if (error instanceof ApiError) throw error;
        throw new ApiError(503, undefined, {
          cause: error,
          reason: 'limit_store_unavailable',
          headers: RETRY_AFTER,
        });
      }
      return { bodyRead, refund };
    },
  };
}
