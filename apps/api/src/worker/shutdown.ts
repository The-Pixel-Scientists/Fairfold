// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Graceful shutdown: stop fetching and let running handlers finish for up to
// a time limit (a handler cut off is rolled back by its connection closing),
// flush telemetry, then close the sender and the pool. Every step runs even
// if an earlier one fails.

export interface Closers {
  /** Stops fetching, waits for handlers up to the limit, and closes pg-boss. */
  stopJobs(timeoutMillis: number): Promise<void>;
  telemetry(): Promise<void>;
  sender(): Promise<void>;
  database(): Promise<void>;
}

export const HANDLER_LIMIT_MILLIS = 25_000;

/** Resolves with the number of steps that failed. */
export async function shutDown(closers: Closers): Promise<number> {
  let failed = 0;
  const steps = [
    () => closers.stopJobs(HANDLER_LIMIT_MILLIS),
    () => closers.telemetry(),
    () => closers.sender(),
    () => closers.database(),
  ];
  for (const step of steps) {
    try {
      await step();
    } catch {
      failed++;
    }
  }
  return failed;
}
