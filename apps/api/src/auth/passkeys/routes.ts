// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Listing and removing your passkeys (ADR 0010; S11-23's contracts). The
// user is always the session's: no route takes a user id, and another
// user's passkey answers as an unknown id. Removing one needs a complete
// session that stepped up within 5 minutes, which the policy checks before
// the body is read, and keeps the last-factor rule (guard.ts). It is an MFA
// change, so in one transaction, under an exclusive lock on the user, it
// records passkey_removed and revokes every session and device cookie; then
// the user is emailed. Events name the factor kind, never the passkey.

import { listPasskeys, removePasskey } from '@pixel-scientists/domain/auth';

import { ApiError } from '../../problems.ts';
import { route, type Route } from '../../routes/register.ts';
import { assertMayRemoveFactor } from '../authenticators/guard.ts';
import { lockForChange, revokeAllForUser } from '../authenticators/revoke.ts';
import { finishMfaChange } from '../authenticators/routes.ts';
import { recordAuthEvent } from '../events.ts';
import { plainAddress } from '../limits.ts';
import { sessionOf, type RouteDependencies } from '../routes.ts';
import { deletePasskey, passkeyName, passkeysOf } from './store.ts';

export function passkeyRoutes(deps: RouteDependencies): Route[] {
  return [
    route(listPasskeys, async ({ context }) => ({
      passkeys: await passkeysOf(deps.auth, sessionOf(context).userId),
    })),

    route(removePasskey, async ({ context, input }) => {
      const session = sessionOf(context);
      const { userId, tenant } = session;
      const { passkeyId } = input.params;
      const at = {
        requestId: context.requestId,
        userId,
        tenant,
        ip: plainAddress(deps.client(context.requestId).ip),
      };
      const removed = await deps.auth.transaction().execute(async (trx) => {
        await lockForChange(trx, session);
        const name = await passkeyName(trx, userId, passkeyId);
        if (name === undefined) throw new ApiError(404, undefined, { reason: 'not_found' });
        await assertMayRemoveFactor(trx, deps.api, session, 'passkey');
        await deletePasskey(trx, userId, passkeyId);
        const event = await recordAuthEvent(trx, 'passkey_removed', { ...at, reason: 'passkey' });
        const revoked = await revokeAllForUser(trx, userId, 'mfa_removed', at);
        return { name, events: [event, revoked.event] };
      });
      return finishMfaChange(deps, context, removed.events, 'passkey_removed', removed.name);
    }),
  ];
}
