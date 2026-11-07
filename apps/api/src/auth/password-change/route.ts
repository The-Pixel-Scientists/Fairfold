// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Changing the password from a complete session that has just stepped up,
// which the policy checks before the body is read, so the route takes only
// the new password (ADR 0010; S11-23's contract). If the account holds a
// factor, the session must have proven it too (lockForChange()). The
// password passes the rules every new password does before anything is
// written. A session whose password was found breached reaches this route
// alone (sessions.ts), and the change clears that state. Then, in one
// transaction, under an exclusive lock on the user: the new hash is set
// with its breach state, every other session and every device cookie is
// revoked, this browser gets a new session id and a fresh device cookie,
// and the events are recorded. The user is emailed once it commits.

import { changePassword } from '@pixel-scientists/domain/auth';

import { ApiError } from '../../problems.ts';
import { route, type Route } from '../../routes/register.ts';
import { lockForChange, revokeOthersForUser } from '../authenticators/revoke.ts';
import { sendNotice } from '../authenticators/notices.ts';
import { sessionCookie } from '../cookies.ts';
import { copyAuthEvent, recordAuthEvent } from '../events.ts';
import { plainAddress } from '../limits.ts';
import { rememberDevice } from '../limits/devices.ts';
import { checkNewPassword, newPasswordState, refuseBreachedAgain } from '../password/policy.ts';
import { hashPassword } from '../passwords.ts';
import { sessionOf, type RouteDependencies } from '../routes.ts';
import type { AuthTables } from '../tables.ts';

export function passwordChangeRoute(deps: RouteDependencies): Route {
  return route(changePassword, async ({ context, input }) => {
    const session = sessionOf(context);
    const { requestId } = context;
    const { userId, tenant, app } = session;
    if (deps.commonPasswords === undefined) {
      throw new ApiError(503, undefined, { reason: 'no_common_password_list' });
    }
    const pending = await checkNewPassword(
      deps,
      requestId,
      deps.commonPasswords,
      input.body.password,
    );
    const hash = await hashPassword(input.body.password);
    const client = deps.client(requestId);
    const at = { requestId, userId, tenant, ip: plainAddress(client.ip) };

    const outcome = await deps.auth.transaction().execute(async (trx) => {
      const current = await lockForChange(trx, session);
      await refuseBreachedAgain(trx, userId, input.body.password);
      const changed = await trx
        .$extendTables<AuthTables>()
        .updateTable('auth.account')
        .set({ password: hash, ...newPasswordState(pending) })
        .where('user_id', '=', userId)
        .where('provider_id', '=', 'credential')
        .executeTakeFirst();
      if (changed.numUpdatedRows === 0n) {
        throw new ApiError(409, 'Your account has no password to change.', {
          reason: 'no_password',
        });
      }
      const event = await recordAuthEvent(trx, 'password_changed', at);
      const revoked = await revokeOthersForUser(trx, current, 'password_changed', {
        ...at,
        userAgent: client.userAgent,
      });
      const device = await rememberDevice(trx, deps, requestId, app, userId);
      return { token: revoked.token, device, events: [event, revoked.event] };
    });

    for (const event of outcome.events) await copyAuthEvent(deps, event, tenant);
    deps.setHeader(requestId, 'set-cookie', sessionCookie(app, outcome.token));
    if (outcome.device !== undefined) deps.setHeader(requestId, 'set-cookie', outcome.device);
    sendNotice(deps, requestId, await session.email(), 'password_changed');
    return undefined;
  });
}
