// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Step-up re-authentication (ADR 0010): a complete console session confirms
// it is the user with their password and a code together, and is replaced
// by a new session, with a new id and token, re-authenticated now, which the
// policy accepts for 5 minutes (S02-05). The attempt is charged to sign-in's
// limits first, and a delayed one is refused without checking either. The
// code is checked only after the password, so a wrong password never spends
// one.

import { chargeRateLimits, refundSignIn, SIGN_IN_SCOPES } from '@pixel-scientists/db';
import { stepUp } from '@pixel-scientists/domain/auth';

import { ApiError } from '../problems.ts';
import { route, type Route } from '../routes/register.ts';
import { copyAuthEvent, recordAuthEvent } from './events.ts';
import { plainAddress } from './limits.ts';
import { verifyNothing, verifyPassword } from './passwords.ts';
import { answerWithSession, sessionOf, type RouteDependencies } from './routes.ts';
import { detailsOf, lockSession, rotateSession } from './sessions.ts';
import { tooMany } from './sign-up.ts';
import type { AuthTables } from './tables.ts';
import { useCode, type TotpKey } from './totp.ts';

export function stepUpRoutes(deps: RouteDependencies, totpKey: () => Promise<TotpKey>): Route[] {
  const users = deps.auth.$extendTables<AuthTables>();

  return [
    route(stepUp, async ({ context, input }) => {
      const session = sessionOf(context);
      if (session.app !== 'console') {
        throw new ApiError(403, undefined, { reason: 'wrong_session' });
      }
      const { requestId } = context;
      const { userId, tenant } = session;
      const email = await session.email();
      const { ip, userAgent } = deps.client(requestId);
      const client = { identifier: deps.keepIdentifier(email), ip: plainAddress(ip) };

      const charged = await chargeRateLimits(deps.auth, SIGN_IN_SCOPES, client);
      if (charged.refused) throw tooMany(deps, requestId, charged.retryAfter);

      const account = await users
        .selectFrom('auth.account')
        .select('password')
        .where('user_id', '=', userId)
        .where('provider_id', '=', 'credential')
        .executeTakeFirst();
      const { password, code } = input.body;
      const matched = account
        ? await verifyPassword(account.password, password)
        : await verifyNothing(password);
      const key = await totpKey();

      const details = { requestId, userId, tenant, ...client };
      const outcome = await deps.auth.transaction().execute(async (trx) => {
        const current = await lockSession(trx, detailsOf(session).tokenHash);
        if (current === undefined) return undefined;
        if (matched && (await useCode(trx, key, userId, code, 'verify'))) {
          await refundSignIn(trx, client);
          const token = await rotateSession(trx, current, {
            reauthenticated: true,
            ip: client.ip,
            userAgent,
          });
          return { token, events: [await recordAuthEvent(trx, 'step_up_completed', details)] };
        }
        const failed = matched
          ? await recordAuthEvent(trx, 'mfa_code_failed', { ...details, reason: 'step_up' })
          : await recordAuthEvent(trx, 'sign_in_failed', { ...details, reason: 'step_up' });
        const events = [failed];
        for (const scope of charged.reached) {
          events.push(
            await recordAuthEvent(trx, 'rate_limit_reached', { ...details, reason: scope }),
          );
        }
        return { token: undefined, events };
      });
      if (outcome === undefined) throw new ApiError(401, undefined, { reason: 'no_session' });
      for (const event of outcome.events) await copyAuthEvent(deps, event, tenant);
      if (outcome.token === undefined) {
        throw new ApiError(401, undefined, { reason: 'step_up_failed' });
      }
      return (await answerWithSession(deps, requestId, outcome.token, email)).body;
    }),
  ];
}
