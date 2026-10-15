// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Password sign-in to a tenant's console or portal (ADR 0010). The attempt
// is charged to its limits first, and a delayed attempt is refused without
// checking the password. An unknown address costs a dummy hash, and every
// failure gets the same problem. Success gives the charge back and issues a
// session for the resolved app with the slug's tenant active: a console
// session waits for MFA, a portal one needs none. A portal sign-in with no
// membership in the tenant makes the person an applicant there.

import {
  chargeRateLimits,
  refundSignIn,
  sessionContext,
  SIGN_IN_SCOPES,
  withTenant,
  type TenantId,
} from '@pixel-scientists/db';
import { signIn } from '@pixel-scientists/domain/auth';

import { recordAudit } from '../audit/writer.ts';
import type { MfaState } from '../context.ts';
import { ApiError } from '../problems.ts';
import { route, type Route } from '../routes/register.ts';
import { hashToken, sessionCookie } from './cookies.ts';
import { copyAuthEvent, recordAuthEvent } from './events.ts';
import { plainAddress } from './limits.ts';
import { verifyNothing, verifyPassword } from './passwords.ts';
import { sessionBody, type RouteDependencies } from './routes.ts';
import { issueSession } from './sessions.ts';
import { appOf, tenantOf, tooMany } from './sign-up.ts';
import type { AuthTables, TenantTables } from './tables.ts';

const SIGN_IN_FAILED = 'The email address or password is not right. Check them and try again.';

/** Make the user an applicant in the tenant, as app_api, unless they hold a membership there. */
async function joinAsApplicant(
  deps: RouteDependencies,
  tenant: TenantId,
  userId: string,
  requestId: string,
): Promise<void> {
  await withTenant(deps.api, tenant, async (tx) => {
    const created = await tx
      .$extendTables<TenantTables>()
      .insertInto('app.membership')
      .values({ tenant_id: tenant, user_id: userId, roles: ['applicant'] })
      .onConflict((conflict) => conflict.columns(['tenant_id', 'user_id']).doNothing())
      .returning('id')
      .executeTakeFirst();
    if (created === undefined) return;
    await recordAudit(
      tx,
      { kind: 'user', membershipId: created.id, requestId },
      {
        action: 'platform.membership.created',
        entityId: created.id,
        changes: { 'app.membership.roles': { after: ['applicant'] } },
      },
    );
  });
}

export function signInRoutes(deps: RouteDependencies): Route[] {
  const users = deps.auth.$extendTables<AuthTables>();

  return [
    route(signIn, async ({ context, input }) => {
      const { requestId } = context;
      const app = appOf(context);
      const tenant = await tenantOf(deps.auth, input.params.slug);
      const { email, password } = input.body;
      const { ip: address, userAgent } = deps.client(requestId);
      const ip = plainAddress(address);
      const identifier = deps.keepIdentifier(email);
      const client = { identifier, ip };

      const charged = await chargeRateLimits(deps.auth, SIGN_IN_SCOPES, client);
      if (charged.refused) throw tooMany(deps, requestId, charged.retryAfter);

      const account = await users
        .selectFrom('auth.user as u')
        .leftJoin('auth.account as a', (join) =>
          join.onRef('a.user_id', '=', 'u.id').on('a.provider_id', '=', 'credential'),
        )
        .select(['u.id', 'u.status', 'u.email_verified', 'a.password'])
        .where('u.email', '=', email)
        .executeTakeFirst();
      const matched = account?.password
        ? await verifyPassword(account.password, password)
        : await verifyNothing(password);

      if (!matched || account?.status !== 'active' || !account.email_verified) {
        const user = account === undefined ? {} : { userId: account.id, tenant: tenant.id };
        await deps.auth.transaction().execute(async (trx) => {
          const reason =
            account === undefined ? 'unknown_identifier' : matched ? 'not_active' : 'bad_password';
          await recordAuthEvent(trx, 'sign_in_failed', { requestId, ...user, ...client, reason });
          for (const scope of charged.reached) {
            await recordAuthEvent(trx, 'rate_limit_reached', {
              requestId,
              ...user,
              ...client,
              reason: scope,
            });
          }
        });
        throw new ApiError(401, SIGN_IN_FAILED, { reason: 'sign_in_failed' });
      }

      const userId = account.id;
      let mfa: MfaState = 'not_required';
      if (app === 'console') {
        const totp = await users
          .selectFrom('auth.two_factor')
          .select('user_id')
          .where('user_id', '=', userId)
          .where('verified', '=', true)
          .executeTakeFirst();
        mfa = totp === undefined ? 'enrol' : 'verify';
      }
      const { token, event } = await deps.auth.transaction().execute(async (trx) => {
        await refundSignIn(trx, client);
        return {
          token: await issueSession(trx, {
            userId,
            app,
            tenantId: tenant.id,
            mfa,
            reauthenticated: true,
            ip,
            ...(userAgent === undefined ? {} : { userAgent }),
          }),
          event: await recordAuthEvent(trx, 'sign_in_succeeded', {
            requestId,
            userId,
            tenant: tenant.id,
            ...client,
          }),
        };
      });

      // The new session is the source of its tenant from here on.
      const session = await sessionContext(deps.api, hashToken(token));
      if (session === undefined) throw new Error('The new session could not be read.');
      if (app === 'portal') await joinAsApplicant(deps, session.tenant, userId, requestId);
      await copyAuthEvent(deps, event, session.tenant);
      deps.setHeader(requestId, 'set-cookie', sessionCookie(app, token));
      return sessionBody(deps.api, {
        userId,
        email,
        app,
        tenant: session.tenant,
        mfa: session.mfaState,
        expiresAt: session.expiresAt,
        reauthenticatedAt: session.reauthenticatedAt,
      });
    }),
  ];
}
