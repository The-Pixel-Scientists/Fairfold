// SPDX-License-Identifier: AGPL-3.0-or-later

import { ProblemError } from '@pixel-scientists/domain/api';

export const signInFailed = 'The email address or password is not right. Check them and try again.';

/**
 * A refused sign-in gets one message however it was refused, so nothing says
 * which part was wrong or whether the account exists. Anything else, such as
 * a field problem or a 429, keeps the words it came with.
 */
export function refusedSignIn(error: unknown): Error {
  if (error instanceof ProblemError && (error.status === 401 || error.status === 403)) {
    return new ProblemError(error.status, signInFailed);
  }
  return error instanceof Error ? error : new Error('The request failed.');
}
