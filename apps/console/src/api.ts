// SPDX-License-Identifier: AGPL-3.0-or-later
//
// How the console calls the API: call() from the domain package, plus the
// words for a refused request and the two session calls the provider needs.

import { call, ProblemError } from '@pixel-scientists/domain/api';
import type { CallInput, CallResult, RouteContract } from '@pixel-scientists/domain/api';
import { getSession, signOut } from '@pixel-scientists/domain/auth';
import type { Session } from '@pixel-scientists/domain/auth';

/** Seconds from a `Retry-After` header: a number, or a date. Null when it says nothing usable. */
export function retryAfterSeconds(header: string | null, now = Date.now()): number | null {
  if (header === null) return null;
  const seconds = /^\d{1,6}$/.test(header) ? Number(header) : (Date.parse(header) - now) / 1000;
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : null;
}

function duration(seconds: number): string {
  if (seconds < 120) return `${String(seconds)} second${seconds === 1 ? '' : 's'}`;
  return `${String(Math.ceil(seconds / 60))} minutes`;
}

/** What a 429 says, with how long to wait when the API said. */
export function tooManyAttempts(seconds: number | null): string {
  return seconds === null
    ? 'Too many attempts. Wait a few minutes, then try again.'
    : `Too many attempts. Wait ${duration(seconds)}, then try again.`;
}

/**
 * call() with the answer to a 429 in words: the API's `Retry-After` is turned
 * into how long to wait, which call() itself does not pass on.
 */
export async function callApi<const C extends RouteContract>(
  route: C,
  input: CallInput<C>,
): Promise<CallResult<C>> {
  let wait: number | null = null;
  try {
    return await call(route, input, {
      fetch: async (url, init) => {
        const response = await fetch(url, init);
        if (response.status === 429) wait = retryAfterSeconds(response.headers.get('retry-after'));
        return response;
      },
    });
  } catch (error) {
    if (error instanceof ProblemError && error.status === 429) {
      throw new ProblemError(429, tooManyAttempts(wait), {
        ...(error.requestId === null ? {} : { requestId: error.requestId }),
      });
    }
    throw error;
  }
}

function isSignedOut(error: unknown): boolean {
  return error instanceof ProblemError && error.status === 401;
}

/** The session, or null when nobody is signed in (a 401). Any other failure is thrown. */
export async function loadSession(): Promise<Session | null> {
  try {
    return await callApi(getSession, {});
  } catch (error) {
    if (isSignedOut(error)) return null;
    throw error;
  }
}

/** Ends the session. A session that has already ended counts as ended. */
export async function endSession(): Promise<void> {
  try {
    await callApi(signOut, {});
  } catch (error) {
    if (!isSignedOut(error)) throw error;
  }
}
