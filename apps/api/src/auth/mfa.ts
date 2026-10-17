// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Setting up an authenticator app and completing a console sign-in with it
// (ADR 0010). Enrol and confirm need a session waiting for enrolment, verify
// one waiting for a code. Each attempt locks its user, then its session, so
// attempts in one session take turns. Every attempt is charged to sign-in's limits
// first (S02-08), and a delayed one is refused without checking the code or
// counting on the session. A right code completes the session as a new one,
// with a new id and token, and gives back its own charge and the sign-in's,
// each to the address it was charged to.
// A wrong one is counted on the session, which is discarded at the fifth.

import { chargeRateLimits, refundSignIn, SIGN_IN_SCOPES } from '@pixel-scientists/db';
import { confirmTotp, enrolTotp, verifyTotp } from '@pixel-scientists/domain/auth';
import { productName } from '@pixel-scientists/domain/platform';

import type { MfaState, RequestContext, RequestSession } from '../context.ts';
import { ApiError } from '../problems.ts';
import { route, type Route } from '../routes/register.ts';
import { clearedCookie } from './cookies.ts';
import { copyAuthEvent, recordAuthEvent, type AuthEvent } from './events.ts';
import { plainAddress } from './limits.ts';
import { answerWithSession, sessionOf, type RouteDependencies } from './routes.ts';
import { detailsOf, lockSession, rotateSession } from './sessions.ts';
import { tooMany } from './sign-up.ts';
import type { AuthTables } from './tables.ts';
import { newSecret, useCode, type TotpKey } from './totp.ts';

/** Wrong codes a session waiting for one may send before it is discarded (ADR 0010). */
const MAX_FAILURES = 5;

/** The request's session, if it waits for `state`. */
function waitingFor(context: RequestContext, state: MfaState): RequestSession {
  const session = sessionOf(context);
  if (session.mfa !== state) throw new ApiError(403, undefined, { reason: 'wrong_session' });
  return session;
}

/** Tell the user an authenticator was added, after the response. */
function sendNotice(deps: RouteDependencies, to: string, requestId: string): void {
  deps.later(async () => {
    if (deps.sender === undefined) {
      deps.log.error({ requestId }, 'No mail sender is set: an MFA notice was not sent');
      return;
    }
    await deps.sender.send({
      to,
      subject: `An authenticator app was added to your ${productName} account`,
      text: [
        `An authenticator app was just set up for your ${productName} account. You will use it each time you sign in to the staff console.`,
        'If you did not set it up, someone else may know your password. Reset your password from the sign-in page and tell your administrator.',
      ].join('\n\n'),
      requestId,
    });
  });
}

/** Confirm a new authenticator, or complete a sign-in, with a code. */
async function completeWithCode(
  deps: RouteDependencies,
  key: TotpKey,
  context: RequestContext,
  code: string,
  use: 'confirm' | 'verify',
) {
  const session = waitingFor(context, use === 'confirm' ? 'enrol' : 'verify');
  const { requestId } = context;
  const { userId, tenant } = session;
  const { ip: address, userAgent } = deps.client(requestId);
  const ip = plainAddress(address);
  const email = await session.email();
  const client = { identifier: deps.keepIdentifier(email), ip };
  const details = { requestId, userId, tenant, ...client };

  const charged = await chargeRateLimits(deps.auth, SIGN_IN_SCOPES, client);
  if (charged.refused) throw tooMany(deps, requestId, charged.retryAfter);

  const outcome = await deps.auth.transaction().execute(async (trx) => {
    // Confirming also sets two_factor_enabled, so it locks the user for that update.
    const lock = use === 'confirm' ? 'no key update' : 'share';
    const current = await lockSession(trx, userId, detailsOf(session).tokenHash, lock);
    if (current === undefined) return undefined;
    const db = trx.$extendTables<AuthTables>();
    if (await useCode(trx, key, userId, code, use)) {
      // Give back this attempt's charge, and the sign-in's, which waited for
      // MFA, to the address that sign-in came from.
      await refundSignIn(trx, client);
      await refundSignIn(trx, { ...client, ip: plainAddress(current.ip_address) });
      const events: AuthEvent[] = [];
      if (use === 'confirm') {
        await db
          .updateTable('auth.user')
          .set({ two_factor_enabled: true })
          .where('id', '=', userId)
          .execute();
        events.push(await recordAuthEvent(trx, 'mfa_enrolled', details));
      }
      const token = await rotateSession(trx, current, { mfa: 'complete', ip, userAgent });
      return { token, events };
    }
    const failures = current.mfa_failures + 1;
    const discarded = failures >= MAX_FAILURES;
    await db
      .updateTable('auth.session')
      .set((eb) => ({
        mfa_failures: failures,
        ...(discarded ? { revoked_at: eb.fn<Date>('now') } : {}),
      }))
      .where('token_hash', '=', current.token_hash)
      .execute();
    const events = [await recordAuthEvent(trx, 'mfa_code_failed', details)];
    if (discarded) events.push(await recordAuthEvent(trx, 'pending_session_discarded', details));
    for (const scope of charged.reached) {
      events.push(await recordAuthEvent(trx, 'rate_limit_reached', { ...details, reason: scope }));
    }
    return { token: undefined, events, discarded };
  });
  if (outcome === undefined) throw new ApiError(401, undefined, { reason: 'no_session' });
  for (const event of outcome.events) await copyAuthEvent(deps, event, tenant);

  if (outcome.token !== undefined) {
    if (use === 'confirm') sendNotice(deps, email, requestId);
    return (await answerWithSession(deps, requestId, outcome.token, email)).body;
  }
  if (outcome.discarded) {
    deps.setHeader(requestId, 'set-cookie', clearedCookie(session.app));
    throw new ApiError(401, undefined, { reason: 'pending_session_discarded' });
  }
  throw new ApiError(401, undefined, { reason: 'mfa_code_failed' });
}

/** The MFA routes. `totpKey` gives Better Auth's key, which encrypts the secrets. */
export function mfaRoutes(deps: RouteDependencies, totpKey: () => Promise<TotpKey>): Route[] {
  return [
    route(enrolTotp, async ({ context }) => {
      const session = waitingFor(context, 'enrol');
      const secret = await newSecret(await totpKey(), await session.email());
      // A secret not yet confirmed is replaced; a confirmed one never is.
      const saved = await deps.auth
        .$extendTables<AuthTables>()
        .insertInto('auth.two_factor')
        .values({ user_id: session.userId, secret: secret.stored, verified: false })
        .onConflict((conflict) =>
          conflict
            .column('user_id')
            .doUpdateSet({ secret: secret.stored })
            .where('auth.two_factor.verified', '=', false),
        )
        .returning('user_id')
        .executeTakeFirst();
      if (saved === undefined) throw new ApiError(403, undefined, { reason: 'mfa_enrolled' });
      return { key: secret.key, uri: secret.uri };
    }),

    route(confirmTotp, async ({ context, input }) =>
      completeWithCode(deps, await totpKey(), context, input.body.code, 'confirm'),
    ),

    route(verifyTotp, async ({ context, input }) =>
      completeWithCode(deps, await totpKey(), context, input.body.code, 'verify'),
    ),
  ];
}
