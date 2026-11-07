// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Replacing and removing the authenticator app from a complete session that
// has just stepped up, which the policy checks before the body is read
// (ADR 0010; S11-23's contracts). If the account holds a factor, the session
// must have proven it too (lockForChange(), revoke.ts).
//
// Start keeps the new secret pending in auth.verification, encrypted as
// auth.two_factor keeps secrets, for 10 minutes, beside the current one,
// which keeps working: auth.two_factor holds one secret per user. Starting
// again replaces only the pending secret. Confirm checks a code from the
// pending secret, then swaps it in with one update that also records the
// code's step, so no earlier code of either secret works again. Remove
// keeps the last-factor rule (guard.ts). Both changes revoke every session
// and device cookie in their transaction, under an exclusive lock on the
// user, so concurrent attempts take turns and only one can spend the pending
// secret. The response clears the session cookie, and the user is emailed.

import type { Transaction } from '@pixel-scientists/db';
import { confirmTotpChange, removeTotp, startTotpChange } from '@pixel-scientists/domain/auth';
import { messages } from '@pixel-scientists/domain/platform';
import { symmetricDecrypt } from 'better-auth/crypto';

import type { RequestContext } from '../../context.ts';
import { ApiError } from '../../problems.ts';
import { route, type Route } from '../../routes/register.ts';
import { clearCodes } from '../backup-codes/store.ts';
import { clearedCookie } from '../cookies.ts';
import { copyAuthEvent, recordAuthEvent, type AuthEvent } from '../events.ts';
import { plainAddress } from '../limits.ts';
import { sessionOf, type RouteDependencies } from '../routes.ts';
import { tokenId } from '../sign-up.ts';
import type { AuthTables } from '../tables.ts';
import { matchingStep, newSecret, type TotpKey } from '../totp.ts';
import { assertMayRemoveFactor, factorsOf } from './guard.ts';
import { sendNotice, type AccountNotice } from './notices.ts';
import { lockForChange, revokeAllForUser } from './revoke.ts';

/** A pending secret's verification value is this prefix, the user's id and the encrypted secret. */
const PENDING = 'totp_change:';
const PENDING_VALUE = /^totp_change:([0-9a-f-]{36}):(\S+)$/;
/** How long a pending secret lasts, on the database's clock. */
const PENDING_FOR = '10 minutes';

const pendingId = (userId: string) => tokenId(`${PENDING}${userId}`);

const wrongCode = () =>
  new ApiError(400, messages.fixFields, {
    errors: [
      {
        field: 'body.code',
        message:
          'This code does not match the new authenticator app, or setting it up took too long. Enter the code the app shows now, or start again.',
      },
    ],
    reason: 'totp_change_failed',
  });

/** Delete the user's pending secret, in `trx` as app_auth. */
async function dropPending(trx: Transaction<unknown>, userId: string): Promise<void> {
  await trx
    .$extendTables<AuthTables>()
    .deleteFrom('auth.verification')
    .where('identifier', '=', pendingId(userId))
    .where((eb) => eb(eb.fn('starts_with', ['value', eb.val(PENDING)]), '=', true))
    .execute();
}

/** The user's live pending secret, as stored, read in `trx` after the user is locked. */
async function pendingSecret(trx: Transaction<unknown>, userId: string) {
  const row = await trx
    .$extendTables<AuthTables>()
    .selectFrom('auth.verification')
    .select('value')
    .where('identifier', '=', pendingId(userId))
    .where((eb) => eb(eb.fn('starts_with', ['value', eb.val(PENDING)]), '=', true))
    .where('expires_at', '>', (eb) => eb.fn<Date>('now'))
    .executeTakeFirst();
  const [, owner, stored] = PENDING_VALUE.exec(row?.value ?? '') ?? [];
  return owner === userId ? stored : undefined;
}

/** Make `stored` the user's confirmed secret, with `step` as its last used step. */
async function swapSecret(trx: Transaction<unknown>, userId: string, stored: string, step: number) {
  const db = trx.$extendTables<AuthTables>();
  const swapped = await db
    .updateTable('auth.two_factor')
    .set({ secret: stored, verified: true, last_used_step: step })
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (swapped.numUpdatedRows === 0n) {
    await db
      .insertInto('auth.two_factor')
      .values({ user_id: userId, secret: stored, verified: true })
      .execute();
    await db
      .updateTable('auth.two_factor')
      .set({ last_used_step: step })
      .where('user_id', '=', userId)
      .execute();
  }
  await db
    .updateTable('auth.user')
    .set({ two_factor_enabled: true })
    .where('id', '=', userId)
    .execute();
}

/** After an MFA change commits: copy its events, clear the cookie and email the user. */
export async function finishMfaChange(
  deps: RouteDependencies,
  context: RequestContext,
  events: readonly AuthEvent[],
  notice: AccountNotice,
  passkey?: string,
): Promise<undefined> {
  const session = sessionOf(context);
  for (const event of events) await copyAuthEvent(deps, event, session.tenant);
  deps.setHeader(context.requestId, 'set-cookie', clearedCookie(session.app));
  sendNotice(deps, context.requestId, await session.email(), notice, passkey);
  return undefined;
}

/** The routes. `totpKey` gives Better Auth's key, which encrypts the secrets. */
export function authenticatorRoutes(
  deps: RouteDependencies,
  totpKey: () => Promise<TotpKey>,
): Route[] {
  const where = (context: RequestContext) => ({
    requestId: context.requestId,
    userId: sessionOf(context).userId,
    tenant: sessionOf(context).tenant,
    ip: plainAddress(deps.client(context.requestId).ip),
  });

  return [
    route(startTotpChange, async ({ context }) => {
      const session = sessionOf(context);
      const secret = await newSecret(await totpKey(), await session.email());
      await deps.auth.transaction().execute(async (trx) => {
        await lockForChange(trx, session);
        await dropPending(trx, session.userId);
        await trx
          .$extendTables<AuthTables>()
          .insertInto('auth.verification')
          .values((eb) => ({
            identifier: pendingId(session.userId),
            value: `${PENDING}${session.userId}:${secret.stored}`,
            expires_at: eb.fn<Date>('date_add', [eb.fn('now'), eb.val(PENDING_FOR)]),
          }))
          .execute();
      });
      return { key: secret.key, uri: secret.uri };
    }),

    route(confirmTotpChange, async ({ context, input }) => {
      const at = where(context);
      const { userId } = at;
      const key = await totpKey();
      const outcome = await deps.auth.transaction().execute(async (trx) => {
        await lockForChange(trx, sessionOf(context));
        const stored = await pendingSecret(trx, userId);
        const secret =
          stored === undefined ? undefined : await symmetricDecrypt({ key, data: stored });
        const step =
          secret === undefined ? null : matchingStep(Buffer.from(secret, 'utf8'), input.body.code);
        if (stored === undefined || step === null) {
          return {
            done: false,
            events: [
              await recordAuthEvent(trx, 'mfa_code_failed', { ...at, reason: 'totp_change' }),
            ],
          };
        }
        await swapSecret(trx, userId, stored, step);
        await dropPending(trx, userId);
        const enrolled = await recordAuthEvent(trx, 'mfa_enrolled', {
          ...at,
          reason: 'totp_change',
        });
        const { event } = await revokeAllForUser(trx, userId, 'mfa_changed', at);
        return { done: true, events: [enrolled, event] };
      });
      if (!outcome.done) {
        for (const event of outcome.events) await copyAuthEvent(deps, event, at.tenant);
        throw wrongCode();
      }
      return finishMfaChange(deps, context, outcome.events, 'totp_changed');
    }),

    route(removeTotp, async ({ context }) => {
      const at = where(context);
      const { userId } = at;
      const session = sessionOf(context);
      // Stored in place of the secret: auth.two_factor rows cannot be deleted,
      // and a secret nobody was shown can never give a code.
      const unknown = await newSecret(await totpKey(), await session.email());
      const events = await deps.auth.transaction().execute(async (trx) => {
        await lockForChange(trx, session);
        if (!(await factorsOf(trx, userId)).includes('totp')) {
          throw new ApiError(409, 'You have no authenticator app to remove.', {
            reason: 'no_factor',
          });
        }
        await assertMayRemoveFactor(trx, deps.api, session, 'totp');
        // The last factor goes, so the backup codes go with it.
        await clearCodes(trx, userId);
        const db = trx.$extendTables<AuthTables>();
        await db
          .updateTable('auth.two_factor')
          .set({ secret: unknown.stored, verified: false, last_used_step: null })
          .where('user_id', '=', userId)
          .execute();
        await db
          .updateTable('auth.user')
          .set({ two_factor_enabled: false })
          .where('id', '=', userId)
          .execute();
        await dropPending(trx, userId);
        const removed = await recordAuthEvent(trx, 'mfa_removed', { ...at, reason: 'totp' });
        const { event } = await revokeAllForUser(trx, userId, 'mfa_removed', at);
        return [removed, event];
      });
      return finishMfaChange(deps, context, events, 'totp_removed');
    }),
  ];
}
