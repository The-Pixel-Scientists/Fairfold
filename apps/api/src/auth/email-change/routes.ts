// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Changing the sign-in email address (ADR 0010; S11-23's contracts).
//
// The request comes from a complete session that stepped up within 5
// minutes, which the policy checks before the body is read. An account an
// IdP created, or whose address a verified SSO domain of the session's
// tenant covers, is refused. Otherwise the answer is 202 at once, whatever
// the address: the lookup, the token and the email happen after the
// response. A free address gets a link; one with an account is told how to
// sign in instead. No link is issued once the session that asked is revoked.
//
// Completing takes the token from the body of a POST, never a URL, and the
// user only from the token. In one transaction, under an exclusive lock on
// the user: the token is spent, the address set (the unique index refuses
// one taken meanwhile), every other session and device cookie revoked, and
// the events recorded. A link issued before the account was signed out
// everywhere, or its password or MFA reset, changed or removed, is refused,
// so recovering the account cancels a pending change. If this browser is
// signed in as the user, it goes on under a new session id; signed in as
// anyone else, the link is refused. Once it commits, the events are copied to
// the audit log of that browser's tenant, or else of the tenant the link was
// asked from, and the old and new addresses are emailed.

import { sessionContext, withTenant, type TenantId } from '@pixel-scientists/db';
import {
  completeEmailChange,
  emailChangeLinkPath,
  requestEmailChange,
} from '@pixel-scientists/domain/auth';
import { messages, type App } from '@pixel-scientists/domain/platform';

import { ApiError } from '../../problems.ts';
import { route, type Route } from '../../routes/register.ts';
import { revokeAllForUser, revokeOthersForUser } from '../authenticators/revoke.ts';
import { hashToken, readToken, sessionCookie } from '../cookies.ts';
import { copyAuthEvent, recordAuthEvent } from '../events.ts';
import { plainAddress } from '../limits.ts';
import { rememberDevice } from '../limits/devices.ts';
import { sessionOf, type RouteDependencies } from '../routes.ts';
import { detailsOf, lockSession, lockUser } from '../sessions.ts';
import { appOf, limitEmails, tenantBase } from '../sign-up.ts';
import type { AuthTables, TenantTables } from '../tables.ts';
import { changedText, confirmedText, confirmText, send, takenText } from './emails.ts';
import { issueToken, recoveredSince, spendToken, tokenIdentifier } from './token.ts';

type SsoTables = { 'auth.sso_domain': { domain: string; state: string } };

const MANAGED =
  'Your organisation manages how you sign in, so change your email address with them.';

interface RequestJob {
  readonly requestId: string;
  readonly userId: string;
  readonly tenant: TenantId;
  readonly app: App;
  readonly email: string;
  /** The hash of the asking session's token. */
  readonly session: Buffer;
}

/** Refuse an account an IdP created, or whose address a verified domain of the tenant covers. */
async function refuseManaged(deps: RouteDependencies, job: RequestJob, current: string) {
  const password = await deps.auth
    .$extendTables<AuthTables>()
    .selectFrom('auth.account')
    .select('user_id')
    .where('user_id', '=', job.userId)
    .where('provider_id', '=', 'credential')
    .executeTakeFirst();
  const domain = current.slice(current.lastIndexOf('@') + 1);
  const claimed = await withTenant(deps.auth, job.tenant, (tx) =>
    tx
      .$extendTables<SsoTables>()
      .selectFrom('auth.sso_domain')
      .select('domain')
      .where('domain', '=', domain)
      .where('state', '=', 'verified')
      .executeTakeFirst(),
  );
  if (password === undefined || claimed !== undefined) {
    throw new ApiError(403, MANAGED, { reason: 'sso_managed' });
  }
}

/** After the response: a link to a free address, or a notice to one with an account. */
async function answerRequest(
  deps: RouteDependencies,
  identify: (token: string) => string,
  job: RequestJob,
) {
  const { slug } = await withTenant(deps.api, job.tenant, (tx) =>
    tx
      .$extendTables<TenantTables>()
      .selectFrom('app.tenant')
      .select('slug')
      .executeTakeFirstOrThrow(),
  );
  const base = tenantBase(deps, job.app, slug);
  const existing = await deps.auth
    .$extendTables<AuthTables>()
    .selectFrom('auth.user')
    .select('id')
    .where('email', '=', job.email)
    .executeTakeFirst();
  if (existing !== undefined) {
    await send(deps, job.requestId, job.email, takenText(base));
    return;
  }
  const change = { userId: job.userId, tenantId: job.tenant, email: job.email };
  const token = await issueToken(deps.auth, identify, change, job.session);
  if (token === undefined) return;
  await send(
    deps,
    job.requestId,
    job.email,
    confirmText(`${base}${emailChangeLinkPath}#token=${token}`),
  );
}

/** The live session this browser holds in `app`, if any; the route itself reads none. */
async function browserSession(deps: RouteDependencies, app: App, cookie: string | undefined) {
  const token = readToken(cookie, app);
  if (token === undefined) return undefined;
  const tokenHash = hashToken(token);
  const row = await sessionContext(deps.api, tokenHash);
  if (row === undefined || row.app !== app) return undefined;
  return { userId: row.userId, tenant: row.tenant, tokenHash };
}

const isTaken = (error: unknown) => (error as { code?: unknown }).code === '23505';

export function emailChangeRoutes(deps: RouteDependencies): Route[] {
  const identify = tokenIdentifier(deps.settings.secret);
  return [
    route(requestEmailChange, async ({ context, input }) => {
      const session = sessionOf(context);
      const { requestId } = context;
      const { userId, tenant, app } = session;
      const { email } = input.body;
      const job = { requestId, userId, tenant, app, email, session: detailsOf(session).tokenHash };
      await refuseManaged(deps, job, await session.email());
      await limitEmails(deps, requestId, {
        identifier: deps.keepIdentifier(email),
        ip: plainAddress(deps.client(requestId).ip),
      });
      deps.later(() => answerRequest(deps, identify, job));
      return undefined;
    }),

    route(completeEmailChange, async ({ context, input }) => {
      const app = appOf(context);
      const { requestId } = context;
      const client = deps.client(requestId);
      const ip = plainAddress(client.ip);
      const linkNotValid = new ApiError(400, messages.linkNotValid, { reason: 'link_not_valid' });
      const browser = await browserSession(deps, app, client.cookie);

      const outcome = await deps.auth.transaction().execute(async (trx) => {
        const change = await spendToken(trx, identify, input.body.token);
        if (change === undefined) throw linkNotValid;
        const { userId } = change;
        if (browser !== undefined && browser.userId !== userId) throw linkNotValid;
        if (!(await lockUser(trx, userId, 'update'))) throw linkNotValid;
        if (await recoveredSince(trx, userId, change.issuedAt)) throw linkNotValid;
        const keep =
          browser === undefined ? undefined : await lockSession(trx, userId, browser.tokenHash);
        const db = trx.$extendTables<AuthTables>();
        const { email: old } = await db
          .selectFrom('auth.user')
          .select('email')
          .where('id', '=', userId)
          .executeTakeFirstOrThrow();
        await db
          .updateTable('auth.user')
          .set({ email: change.email })
          .where('id', '=', userId)
          .execute()
          .catch((error: unknown) => {
            throw isTaken(error) ? linkNotValid : error;
          });

        // The signed-in browser's tenant, or else the one the link was asked from.
        const tenant =
          keep === undefined || browser === undefined ? change.tenantId : browser.tenant;
        const at = { requestId, userId, tenant, ip };
        const event = await recordAuthEvent(trx, 'email_changed', at);
        if (keep === undefined) {
          const revoked = await revokeAllForUser(trx, userId, 'email_changed', at);
          return { old, email: change.email, tenant, events: [event, revoked.event] };
        }
        const revoked = await revokeOthersForUser(trx, keep, 'email_changed', {
          ...at,
          userAgent: client.userAgent,
        });
        const device = await rememberDevice(trx, deps, requestId, app, userId);
        const cookies = [
          sessionCookie(app, revoked.token),
          ...(device === undefined ? [] : [device]),
        ];
        return { old, email: change.email, tenant, events: [event, revoked.event], cookies };
      });

      const changedAt = new Date();
      for (const event of outcome.events) await copyAuthEvent(deps, event, outcome.tenant);
      for (const cookie of outcome.cookies ?? []) deps.setHeader(requestId, 'set-cookie', cookie);
      deps.later(() => send(deps, requestId, outcome.old, changedText(changedAt)));
      deps.later(() => send(deps, requestId, outcome.email, confirmedText()));
      return undefined;
    }),
  ];
}
