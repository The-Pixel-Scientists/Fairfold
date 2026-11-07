// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Upload counters (ADR 0030, amending ADR 0028): four buckets in
// app.request_limit, charged after the session and permission checks and
// before the body is read, by the declared Content-Length. The membership
// key comes from the session; the address key is the client address, IPv6
// by /64. Both are stored only as HMACs.

const MiB = 1024 * 1024;
const HOUR = 60 * 60;

export const uploadBuckets = [
  'upload_files_membership',
  'upload_bytes_membership',
  'upload_files_address',
  'upload_bytes_address',
] as const;

export type UploadBucket = (typeof uploadBuckets)[number];

export interface UploadLimit {
  /** What one upload adds: 1 for a file, or its declared length in bytes. */
  readonly counts: 'files' | 'bytes';
  readonly key: 'membership' | 'address';
  readonly windowSeconds: number;
  readonly max: number;
}

export const uploadLimits: Readonly<Record<UploadBucket, UploadLimit>> = {
  upload_files_membership: { counts: 'files', key: 'membership', windowSeconds: HOUR, max: 100 },
  upload_bytes_membership: {
    counts: 'bytes',
    key: 'membership',
    windowSeconds: 12 * HOUR,
    max: 250 * MiB,
  },
  upload_files_address: { counts: 'files', key: 'address', windowSeconds: HOUR, max: 300 },
  upload_bytes_address: {
    counts: 'bytes',
    key: 'address',
    windowSeconds: 12 * HOUR,
    max: 1024 * MiB,
  },
};

/** What an upload declaring `declaredBytes` adds to a bucket. */
export function uploadCharge(bucket: UploadBucket, declaredBytes: number): number {
  return uploadLimits[bucket].counts === 'files' ? 1 : declaredBytes;
}

/** The most upload bodies one API process reads at once; beyond it, 503. */
export const MAX_UPLOAD_BODIES_AT_ONCE = 16;

/** The 429 text: when to try again, rounded up to whole minutes or hours. */
export function uploadLimitMessage(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  const wait = minutes < 60 ? plural(minutes, 'minute') : plural(Math.ceil(minutes / 60), 'hour');
  return `You have uploaded as many files as you can for now. Try again in ${wait}.`;
}

function plural(count: number, unit: string): string {
  return `${String(count)} ${unit}${count === 1 ? '' : 's'}`;
}
