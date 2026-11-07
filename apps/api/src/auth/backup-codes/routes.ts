// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The backup code routes (ADR 0010; S11-23's contracts). Generate needs a
// complete session that has just stepped up, which the policy checks, and a
// confirmed authenticator; it replaces any earlier set and answers the codes
// in that response only. Count answers how many are left. Verify completes
// a sign-in waiting for a code through completeWithCode() (mfa.ts), so a
// wrong code counts towards the same five attempts and the same limits as an
// authenticator code, but the session it completes has not re-authenticated,
// so it passes no step-up check. The user is emailed after each change,
// with no code.

import {
  countBackupCodes,
  generateBackupCodes,
  verifyBackupCode,
} from '@pixel-scientists/domain/auth';
import { productName } from '@pixel-scientists/domain/platform';

import { ApiError } from '../../problems.ts';
import { route, type Route } from '../../routes/register.ts';
import { lockForChange } from '../authenticators/revoke.ts';
import { copyAuthEvent, recordAuthEvent } from '../events.ts';
import { plainAddress } from '../limits.ts';
import { completeWithCode } from '../mfa.ts';
import { sessionOf, type RouteDependencies } from '../routes.ts';
import { backupCodeKeys } from './codes.ts';
import { countCodes, replaceCodes, useBackupCode } from './store.ts';

const NO_FACTOR = 'Set up an authenticator app before you make backup codes.';

const IF_NOT_YOU =
  'If you did not do this, reset your password from the sign-in page now and tell the organisation you work with or apply to.';

/** Email `to`, after the response, that codes were made, or one was used with `left` left. */
function sendNotice(deps: RouteDependencies, requestId: string, to: string, left?: number): void {
  const [subject, happened] =
    left === undefined
      ? [
          `New backup codes were made for your ${productName} account`,
          'New backup codes were made for your account. Any backup codes you had before no longer work.',
        ]
      : [
          `A backup code was used to sign in to your ${productName} account`,
          `A backup code was used to sign in to your account. You have ${String(left)} backup ${left === 1 ? 'code' : 'codes'} left.`,
        ];
  deps.later(async () => {
    if (deps.sender === undefined) {
      deps.log.error({ requestId }, 'No mail sender is set: a backup code notice was not sent');
      return;
    }
    await deps.sender.send({ to, subject, text: [happened, IF_NOT_YOU].join('\n\n'), requestId });
  });
}

export function backupCodeRoutes(deps: RouteDependencies): Route[] {
  const keys = backupCodeKeys(deps.settings.secrets);

  return [
    route(generateBackupCodes, async ({ context }) => {
      const session = sessionOf(context);
      const { requestId } = context;
      const { userId, tenant } = session;
      const ip = plainAddress(deps.client(requestId).ip);
      const made = await deps.auth.transaction().execute(async (trx) => {
        await lockForChange(trx, session);
        const codes = await replaceCodes(trx, keys, userId);
        if (codes === undefined) throw new ApiError(409, NO_FACTOR, { reason: 'no_factor' });
        const details = { requestId, userId, tenant, ip };
        return { codes, event: await recordAuthEvent(trx, 'backup_codes_regenerated', details) };
      });
      await copyAuthEvent(deps, made.event, tenant);
      sendNotice(deps, requestId, await session.email());
      return { codes: made.codes };
    }),

    route(countBackupCodes, async ({ context }) => ({
      remaining: await countCodes(deps.auth, sessionOf(context).userId),
    })),

    route(verifyBackupCode, async ({ context, input }) =>
      completeWithCode(deps, context, 'verify', async (trx, details) => {
        const left = await useBackupCode(trx, keys, details.userId, input.body.code);
        if (left === undefined) return undefined;
        return {
          events: [await recordAuthEvent(trx, 'backup_code_used', details)],
          notify: (email) => {
            sendNotice(deps, details.requestId, email, left);
          },
          // The password's re-authentication does not carry over: a
          // backup code is not a step-up.
          reauthenticated: false,
        };
      }),
    ),
  ];
}
