// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Step-up re-authentication (ADR 0010): a complete session, console or
// portal, confirms it is the user with their password and a code together,
// or, for an account with no factor, the password alone, and is replaced by
// a new session, with a new id and token, re-authenticated now, which the
// policy accepts for 5 minutes (S02-05). The server decides which way the
// account may use: any other way gets the same answer as a wrong password.
// The attempt is charged to sign-in's limits first, the device's alone with
// a valid device cookie, and a delayed one is refused without checking
// anything. The rest is checked only after the password, so a wrong
// password never spends a code. The password is checked again, under the
// session's lock, against the hash as it is then (sessions.ts).

import {
  chargeRateLimits,
  refundSignIn,
  signInScopes,
  type Transaction,
} from '@pixel-scientists/db';
import { stepUp, stepUpWithPassword, type AuthEventCode } from '@pixel-scientists/domain/auth';

import type { RequestContext } from '../context.ts';
import { ApiError } from '../problems.ts';
import { route, type Route } from '../routes/register.ts';
import { factorsOf } from './authenticators/guard.ts';
import { copyAuthEvent, recordAuthEvent } from './events.ts';
import { plainAddress } from './limits.ts';
import { countedClient } from './limits/devices.ts';
import { verifyNothing, verifyPassword } from './passwords.ts';
import { answerWithSession, sessionOf, type RouteDependencies } from './routes.ts';
import { currentPassword, detailsOf, lockSession, rotateSession } from './sessions.ts';
import { tooMany } from './sign-up.ts';
import type { AuthTables } from './tables.ts';
import { useCode, type TotpKey } from './totp.ts';

/** What step-up needs beside the password, checked under the session's lock. */
interface Rest {
  readonly holds: (trx: Transaction<unknown>, userId: string) => Promise<boolean>;
  /** The event when the password was right and the rest was not. */
  readonly failed: { readonly code: AuthEventCode; readonly reason: string };
}

async function stepUpWith(
  deps: RouteDependencies,
  context: RequestContext,
  password: string,
  rest: Rest,
) {
  const session = sessionOf(context);
  const { requestId } = context;
  const { userId, tenant } = session;
  const email = await session.email();
  const { ip, userAgent } = deps.client(requestId);
  const client = { identifier: deps.keepIdentifier(email), ip: plainAddress(ip) };
  const counted = await countedClient(deps, requestId, session.app, email, client);

  const charged = await chargeRateLimits(deps.auth, signInScopes(counted), counted);
  if (charged.refused) throw tooMany(deps, requestId, charged.retryAfter);

  const account = await deps.auth
    .$extendTables<AuthTables>()
    .selectFrom('auth.account')
    .select('password')
    .where('user_id', '=', userId)
    .where('provider_id', '=', 'credential')
    .executeTakeFirst();
  const matched = account
    ? await verifyPassword(account.password, password)
    : await verifyNothing(password);

  const details = { requestId, userId, tenant, ...client };
  const outcome = await deps.auth.transaction().execute(async (trx) => {
    const current = await lockSession(trx, userId, detailsOf(session).tokenHash);
    if (current === undefined) return undefined;
    // A password that a reset has replaced since it was checked does not count.
    const confirmed = matched && (await currentPassword(trx, userId)) === account?.password;
    if (confirmed && (await rest.holds(trx, userId))) {
      await refundSignIn(trx, counted);
      const token = await rotateSession(trx, current, {
        reauthenticated: true,
        ip: client.ip,
        userAgent,
      });
      return { token, events: [await recordAuthEvent(trx, 'step_up_completed', details)] };
    }
    const failed = confirmed
      ? await recordAuthEvent(trx, rest.failed.code, { ...details, reason: rest.failed.reason })
      : await recordAuthEvent(trx, 'sign_in_failed', { ...details, reason: 'step_up' });
    const events = [failed];
    for (const scope of charged.reached) {
      events.push(await recordAuthEvent(trx, 'rate_limit_reached', { ...details, reason: scope }));
    }
    return { token: undefined, events };
  });
  if (outcome === undefined) throw new ApiError(401, undefined, { reason: 'no_session' });
  for (const event of outcome.events) await copyAuthEvent(deps, event, tenant);
  if (outcome.token === undefined) {
    throw new ApiError(401, undefined, { reason: 'step_up_failed' });
  }
  return (await answerWithSession(deps, requestId, outcome.token, email)).body;
}

export function stepUpRoutes(deps: RouteDependencies, totpKey: () => Promise<TotpKey>): Route[] {
  return [
    route(stepUp, async ({ context, input }) => {
      const key = await totpKey();
      return stepUpWith(deps, context, input.body.password, {
        holds: (trx, userId) => useCode(trx, key, userId, input.body.code, 'verify'),
        failed: { code: 'mfa_code_failed', reason: 'step_up' },
      });
    }),

    route(stepUpWithPassword, ({ context, input }) =>
      stepUpWith(deps, context, input.body.password, {
        holds: async (trx, userId) => (await factorsOf(trx, userId)).length === 0,
        failed: { code: 'sign_in_failed', reason: 'step_up_factor_required' },
      }),
    ),
  ];
}
