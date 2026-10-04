// SPDX-License-Identifier: AGPL-3.0-or-later

import { stepUp } from '@pixel-scientists/domain/auth';
import type { SessionData, StepUpCredentials } from '@pixel-scientists/ui';

import { callApi } from '../api.ts';
import { refused } from './failures.ts';

export const stepUpFailed = 'Your password or code is not right. Check them and try again.';

/**
 * Re-authenticates for an action that needs a recent sign-in. A screen
 * passes this, with the session's `setSession`, as the StepUpDialog's
 * `onConfirm`, then repeats the action once the dialog has closed. The
 * session that comes back holds the new `recentAuthUntil`.
 */
export async function confirmItsYou(
  credentials: StepUpCredentials,
  setSession: (session: SessionData) => void,
): Promise<void> {
  try {
    setSession(await callApi(stepUp, { body: credentials }));
  } catch (error) {
    throw refused(error, stepUpFailed);
  }
}
