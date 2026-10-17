// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Switching the active tenant (ADR 0010): to one of the user's active
// memberships with a role in this app, as auth.session_memberships() lists
// them for the live session, and to nothing else; any other id gets the same
// 404. The switch is a new session with a new id, active in the new tenant.
// MFA belongs to the user, so a complete console session stays complete.

import { sessionMemberships } from '@pixel-scientists/db';
import { switchTenant } from '@pixel-scientists/domain/auth';

import { ApiError } from '../problems.ts';
import { route, type Route } from '../routes/register.ts';
import { copyAuthEvent, recordAuthEvent } from './events.ts';
import { plainAddress } from './limits.ts';
import { answerWithSession, appRoles, sessionOf, type RouteDependencies } from './routes.ts';
import { detailsOf, lockSession, rotateSession } from './sessions.ts';

export function switchTenantRoutes(deps: RouteDependencies): Route[] {
  return [
    route(switchTenant, async ({ context, input }) => {
      const session = sessionOf(context);
      const { requestId } = context;
      const { tokenHash } = detailsOf(session);
      const target = (await sessionMemberships(deps.api, tokenHash)).find(
        ({ membershipId, roles }) =>
          membershipId === input.body.membershipId && appRoles(roles, session.app).length > 0,
      );
      if (target === undefined) throw new ApiError(404, undefined, { reason: 'not_found' });

      const { ip: address, userAgent } = deps.client(requestId);
      const ip = plainAddress(address);
      const switched = await deps.auth.transaction().execute(async (trx) => {
        const current = await lockSession(trx, session.userId, tokenHash);
        if (current === undefined) return undefined;
        return {
          token: await rotateSession(trx, current, { tenantId: target.tenantId, ip, userAgent }),
          event: await recordAuthEvent(trx, 'tenant_switched', {
            requestId,
            userId: session.userId,
            tenant: target.tenantId,
            ip,
          }),
        };
      });
      if (switched === undefined) throw new ApiError(401, undefined, { reason: 'no_session' });

      const { tenant, body } = await answerWithSession(
        deps,
        requestId,
        switched.token,
        await session.email(),
      );
      await copyAuthEvent(deps, switched.event, tenant);
      return body;
    }),
  ];
}
