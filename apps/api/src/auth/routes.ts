// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The auth routes this module serves so far (S02-01's contracts): sign-up,
// sign-in, reading the session and signing out. The MFA routes arrive with
// S02-09.

import { withTenant, type Kysely, type TenantId } from '@pixel-scientists/db';
import { getSession, signOut, type Session } from '@pixel-scientists/domain/auth';
import {
  permissionsFor,
  roles,
  type App,
  type Permission,
  type Role,
} from '@pixel-scientists/domain/platform';

import type { MfaState, RequestContext, RequestSession } from '../context.ts';
import type { Sender } from '../email/sender.ts';
import { STEP_UP_WINDOW_MS } from '../policy/index.ts';
import { ApiError } from '../problems.ts';
import { route, type Route } from '../routes/register.ts';
import { clearedCookie } from './cookies.ts';
import { copyAuthEvent, recordAuthEvent, type CopyDependencies } from './events.ts';
import { detailsOf, revoke } from './sessions.ts';
import type { AuthSettings } from './settings.ts';
import { signInRoutes } from './sign-in.ts';
import { signUpRoutes } from './sign-up.ts';
import type { TenantTables } from './tables.ts';

export interface RouteDependencies extends CopyDependencies {
  readonly settings: AuthSettings;
  /** Sends the auth emails. Until main.ts passes one, they are logged as not sent. */
  readonly sender: Sender | undefined;
  /** The bundled common-password list, or undefined if it did not load: then no password can be set. */
  readonly commonPasswords: ReadonlySet<string> | undefined;
  /** A typed identifier as counters and events keep it (limits.ts). */
  readonly keepIdentifier: (typed: string) => string;
  /** The client of the request with this id, as Fastify derived it through the trusted proxies. */
  readonly client: (requestId: string) => { readonly ip: string; readonly userAgent?: string };
  /** Adds a header to the response to the request with this id. */
  readonly setHeader: (requestId: string, name: string, value: string) => void;
  /** Runs work after the response is sent, logging any failure. */
  readonly later: (work: () => Promise<void>) => void;
}

interface Active {
  readonly membership: NonNullable<
    Extract<Session, { app: 'console'; mfa: 'complete' }>['activeMembership']
  >;
  readonly permissions: Permission[];
}

/**
 * The session's active membership in its app, with its roles for that app,
 * and the permissions they give less those of modules switched off for the
 * tenant (no row means on). None if it has no role in this app.
 */
async function activeMembership(
  api: Kysely<unknown>,
  tenant: TenantId,
  userId: string,
  app: App,
): Promise<Active | null> {
  return withTenant(api, tenant, async (tx) => {
    const db = tx.$extendTables<TenantTables>();
    const row = await db
      .selectFrom('app.membership as m')
      .innerJoin('app.tenant as t', 't.id', 'm.tenant_id')
      .select(['m.id', 'm.roles', 't.slug', 't.name'])
      .where('m.user_id', '=', userId)
      .where('m.status', '=', 'active')
      .where('t.status', '=', 'active')
      .executeTakeFirst();
    if (row === undefined) return null;
    const appRoles = row.roles.filter(
      (name): name is Role => Object.hasOwn(roles, name) && roles[name as Role].app === app,
    );
    if (appRoles.length === 0) return null;
    const off = await db
      .selectFrom('app.tenant_module')
      .select('module')
      .where('enabled', '=', false)
      .execute();
    const offModules = new Set(off.map(({ module }) => module));
    return {
      membership: { id: row.id, tenant: { slug: row.slug, name: row.name }, roles: appRoles },
      permissions: permissionsFor(appRoles, app).filter(
        (permission) => !offModules.has(permission.split('.', 1)[0] ?? ''),
      ),
    };
  });
}

/** What the apps see of a session. */
export interface SessionView {
  readonly userId: string;
  readonly email: string;
  readonly app: App;
  readonly tenant: TenantId;
  readonly mfa: MfaState;
  readonly expiresAt: Date;
  readonly reauthenticatedAt: Date | null;
}

/** The session as the apps read it (sessionSchema). */
export async function sessionBody(api: Kysely<unknown>, view: SessionView): Promise<Session> {
  const common = {
    user: { id: view.userId, email: view.email },
    expiresAt: view.expiresAt.toISOString(),
    app: view.app,
    mfa: view.mfa,
  };
  if (view.mfa === 'enrol' || view.mfa === 'verify') {
    return {
      ...common,
      recentAuthUntil: null,
      activeMembership: null,
      memberships: [],
      permissions: [],
    } as Session;
  }
  const active = await activeMembership(api, view.tenant, view.userId, view.app);
  return {
    ...common,
    recentAuthUntil:
      view.reauthenticatedAt === null
        ? null
        : new Date(view.reauthenticatedAt.getTime() + STEP_UP_WINDOW_MS).toISOString(),
    // Until S02-09 lists them all, the active membership is the only one to switch to.
    activeMembership: active?.membership ?? null,
    memberships: active === null ? [] : [active.membership],
    permissions: active?.permissions ?? [],
  } as Session;
}

function sessionOf(context: RequestContext): RequestSession {
  // The route's `session: 'any'` has already refused a request without one.
  if (context.session === null) throw new ApiError(401);
  return context.session;
}

export function authRoutes(deps: RouteDependencies): Route[] {
  return [
    ...signUpRoutes(deps),
    ...signInRoutes(deps),

    route(getSession, async ({ context }) => {
      const session = sessionOf(context);
      const { expiresAt, reauthenticatedAt } = detailsOf(session);
      return sessionBody(deps.api, {
        ...session,
        email: await session.email(),
        expiresAt,
        reauthenticatedAt,
      });
    }),

    route(signOut, async ({ context }) => {
      const session = sessionOf(context);
      const { tokenHash, ip } = detailsOf(session);
      const event = await deps.auth.transaction().execute(async (trx) => {
        await revoke(trx, tokenHash);
        return recordAuthEvent(trx, 'signed_out', {
          requestId: context.requestId,
          userId: session.userId,
          tenant: session.tenant,
          ip,
        });
      });
      await copyAuthEvent(deps, event, session.tenant);
      deps.setHeader(context.requestId, 'set-cookie', clearedCookie(session.app));
      return undefined;
    }),
  ];
}
