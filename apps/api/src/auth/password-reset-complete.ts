// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Completing a password reset (ADR 0010). A token that is not live is
// refused before the password is hashed, and a refused password leaves it
// usable. Then, in one transaction, with completions for the account taking
// turns: the token and every other reset link of the account are spent, the
// user is locked against sessions being issued, the new password is set,
// every session is revoked, the address's sign-in counters and delays are
// cleared, and the events are recorded. It never signs in and never touches
// MFA, and the user is emailed a notice.

import { completePasswordReset } from '@pixel-scientists/domain/auth';
import { messages, productName } from '@pixel-scientists/domain/platform';

import { ApiError } from '../problems.ts';
import { route, type Route } from '../routes/register.ts';
import { recordAuthEvent } from './events.ts';
import { plainAddress } from './limits.ts';
import { hashPassword } from './passwords.ts';
import { RESET, sendResetEmail, VALUE } from './password-reset.ts';
import type { RouteDependencies } from './routes.ts';
import { revokeAll } from './sessions.ts';
import { refuseCommonPassword, tokenId } from './sign-up.ts';
import type { AuthTables } from './tables.ts';

export function completeResetRoute(deps: RouteDependencies): Route {
  return route(completePasswordReset, async ({ context, input }) => {
    const { requestId } = context;
    const { token, password } = input.body;
    if (deps.commonPasswords === undefined) {
      throw new ApiError(503, undefined, { reason: 'no_common_password_list' });
    }
    const linkNotValid = new ApiError(400, messages.linkNotValid, { reason: 'link_not_valid' });
    const identifier = tokenId(token);
    const live = await deps.auth
      .$extendTables<AuthTables>()
      .selectFrom('auth.verification')
      .select('value')
      .where('identifier', '=', identifier)
      .where((eb) => eb(eb.fn('starts_with', ['value', eb.val(RESET)]), '=', true))
      .where('expires_at', '>', (eb) => eb.fn<Date>('now'))
      .executeTakeFirst();
    const [value, userId, tenantId] = VALUE.exec(live?.value ?? '') ?? [];
    if (value === undefined || userId === undefined || tenantId === undefined) {
      throw linkNotValid;
    }
    refuseCommonPassword(deps.commonPasswords, password);
    const hash = await hashPassword(password);
    const ip = plainAddress(deps.client(requestId).ip);

    const email = await deps.auth.transaction().execute(async (trx) => {
      const db = trx.$extendTables<AuthTables>();
      // Completions for one account take turns, so a link spent by one is gone for the next.
      const lock = `${RESET}${userId}:`;
      await db
        .selectNoFrom((eb) =>
          eb.fn('pg_advisory_xact_lock', [eb.fn('hashtext', [eb.val(lock)])]).as('locked'),
        )
        .execute();
      const spent = await db
        .deleteFrom('auth.verification')
        .where('identifier', '=', identifier)
        .where('value', '=', value)
        .where('expires_at', '>', (eb) => eb.fn<Date>('now'))
        .executeTakeFirst();
      if (spent.numDeletedRows === 0n) throw linkNotValid;
      await db
        .deleteFrom('auth.verification')
        .where((eb) => eb(eb.fn('starts_with', ['value', eb.val(lock)]), '=', true))
        .execute();
      // Locked before the password changes: a session being issued for the
      // user commits first and is revoked below, and one issued after this
      // commits sees the new password (sessions.ts).
      const user = await db
        .selectFrom('auth.user')
        .select('email')
        .where('id', '=', userId)
        .where('status', '=', 'active')
        .forUpdate()
        .executeTakeFirst();
      if (user === undefined) throw linkNotValid;
      const changed = await db
        .updateTable('auth.account')
        .set({ password: hash })
        .where('user_id', '=', userId)
        .where('provider_id', '=', 'credential')
        .executeTakeFirst();
      if (changed.numUpdatedRows === 0n) throw linkNotValid;
      await revokeAll(trx, { userId });
      await db
        .deleteFrom('auth.rate_limit')
        .where('scope', 'in', ['sign_in_identifier_ip', 'sign_in_identifier'])
        .where('identifier', '=', user.email)
        .execute();
      const details = { requestId, userId, tenant: tenantId, ip };
      await recordAuthEvent(trx, 'password_reset_completed', {
        ...details,
        identifier: user.email,
      });
      await recordAuthEvent(trx, 'sessions_revoked', { ...details, reason: 'password_reset' });
      return user.email;
    });

    deps.later(() =>
      sendResetEmail(deps, requestId, email, `Your ${productName} password has changed`, [
        `The password for your ${productName} account was just changed with a reset link sent to this address, and you were signed out everywhere.`,
        'If you did this, sign in with your new password.',
        'If you did not, someone may be able to read your email. Secure your email account, then ask for a new reset link from the sign-in page.',
      ]),
    );
    return undefined;
  });
}
