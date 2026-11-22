// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A register's rate limit as ADR 0031 sets it, kept by this process: a call
// over the allowance is not made, and its job retries later with backoff.

export type Allow = () => boolean;

/** At most `max` calls in any `windowMs`. */
export function allowance(max: number, windowMs: number, now: () => number = Date.now): Allow {
  let calls: number[] = [];
  return () => {
    const at = now();
    calls = calls.filter((time) => at - time < windowMs);
    if (calls.length >= max) return false;
    calls.push(at);
    return true;
  };
}
