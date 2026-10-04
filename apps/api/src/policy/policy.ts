// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The one place that decides whether a caller may run a route (ADR 0004,
// ADR 0010, ADR 0016). It checks permissions, never role names: roles reach
// this code only through the domain's role map.
//
// It runs in two steps. checkSession() needs no database and runs before the
// request body is read: the right app, a session in the state the route
// needs, and re-authentication for step-up. asMember() runs inside the
// session's tenant transaction: an active membership, the module switched
// on, the permission, then the route's scope rule.
//
// A refusal is an ApiError with a code for the log. Denials are logged, not
// audited. A caller learns no more from a refusal than it needs: 401 to sign
// in, 403 for a missing permission, 404 for anything it may not know exists.

import type { RouteContract } from '@pixel-scientists/domain/api';
import {
  permissionsFor,
  switchableModuleIds,
  type ModuleId,
  type Permission,
} from '@pixel-scientists/domain/platform';

import { recordAudit, recordRead, type AuditActor } from '../audit/writer.ts';
import type { MemberContext, RequestContext, RequestSession } from '../context.ts';
import type { InTenant, TenantTransaction } from '../database.ts';
import { ApiError } from '../problems.ts';
import type { ScopeInput, ScopeResolvers } from './scopes.ts';

/** How long re-authentication counts as recent (ADR 0010). */
export const STEP_UP_WINDOW_MS = 5 * 60 * 1000;

/** What the policy reads from the database; the migration is packages/db/migrations/0002_app_tenancy. */
type PolicyTables = {
  'app.membership': { id: string; user_id: string; roles: string[]; status: string };
  'app.tenant_module': { module: string; enabled: boolean };
};

type Reason =
  | 'no_session'
  | 'mfa_pending'
  | 'wrong_session'
  | 'step_up'
  | 'no_membership'
  | 'module_off'
  | 'no_permission'
  | 'out_of_scope';

function refuse(status: 401 | 403 | 404, reason: Reason, detail?: string): ApiError {
  return new ApiError(status, detail, { reason });
}

/** MFA is settled for staff by a code, and for applicants, who have none, not at all. */
function mfaSettled(session: RequestSession): boolean {
  return session.mfa === 'complete' || (session.mfa === 'not_required' && session.app === 'portal');
}

function mfaWaiting(session: RequestSession): boolean {
  return session.mfa === 'enrol' || session.mfa === 'verify';
}

/** Throws unless the session is what the route needs. Reads nothing but the context. */
export function checkSession(
  route: RouteContract,
  context: RequestContext,
  now: number = Date.now(),
): void {
  if (route.audience === 'public') return;
  const { session } = context;

  if (route.audience === 'auth') {
    if (route.session === 'none') return;
    if (session === null) throw refuse(401, 'no_session');
    if (context.app !== session.app) throw refuse(403, 'wrong_session');
    if (route.session === 'mfa_pending' && !mfaWaiting(session)) {
      throw refuse(403, 'wrong_session');
    }
    if (route.session === 'complete' && !mfaSettled(session)) throw refuse(401, 'mfa_pending');
    return;
  }

  if (session === null) throw refuse(401, 'no_session');
  if (!mfaSettled(session)) throw refuse(401, 'mfa_pending');
  if (context.app !== route.audience || session.app !== route.audience) {
    throw refuse(403, 'wrong_session');
  }
  if (route.stepUp === true) {
    const at = session.recentAuthAt?.getTime();
    if (at === undefined || now - at > STEP_UP_WINDOW_MS || at > now) {
      throw refuse(403, 'step_up', 'Confirm it is you again, then try again.');
    }
  }
}

export interface MemberRequest {
  readonly route: Extract<RouteContract, { audience: 'console' | 'portal' }>;
  readonly context: RequestContext;
  readonly input: ScopeInput;
  readonly resolvers: ScopeResolvers;
}

/**
 * Runs `run` in the session's tenant transaction, as a member who may make
 * this request, or throws. The tenant is the session's own, so row-level
 * security shows only that tenant's memberships and module switches. The
 * handler's own work is in the same transaction and commits with it.
 */
export async function asMember<T>(
  inTenant: InTenant,
  { route, context, input, resolvers }: MemberRequest,
  run: (tx: TenantTransaction, caller: MemberContext) => Promise<T>,
): Promise<T> {
  const { session } = context;
  if (session === null || context.app === null) throw refuse(401, 'no_session');

  return inTenant(session.tenant, async (tx) => {
    const db = tx.$extendTables<PolicyTables>();

    const membership = await db
      .selectFrom('app.membership')
      .select(['id', 'roles'])
      .where('user_id', '=', session.userId)
      .where('status', '=', 'active')
      .executeTakeFirst();
    if (membership === undefined) throw refuse(403, 'no_membership');

    // A module without a row is on, and only a switchable module can be off.
    if ((switchableModuleIds as readonly ModuleId[]).includes(route.module)) {
      const switched = await db
        .selectFrom('app.tenant_module')
        .select('enabled')
        .where('module', '=', route.module)
        .executeTakeFirst();
      if (switched?.enabled === false) throw refuse(404, 'module_off');
    }

    const permissions = new Set<Permission>(permissionsFor(membership.roles, session.app));
    if (!permissions.has(route.permission)) throw refuse(403, 'no_permission');

    const resolver = resolvers[route.scope];
    if (resolver === undefined) throw new Error(`The scope rule ${route.scope} has no resolver.`);
    const inScope = await resolver({
      tx,
      userId: session.userId,
      membershipId: membership.id,
      input,
    });
    if (!inScope) throw refuse(404, 'out_of_scope');

    const actor: AuditActor = {
      kind: 'user',
      membershipId: membership.id,
      requestId: context.requestId,
    };
    return run(tx, {
      ...context,
      app: session.app,
      session,
      audit: {
        record: (event) => recordAudit(tx, actor, event),
        read: (entity) => recordRead(tx, actor, entity),
      },
      membership: { id: membership.id, permissions },
    });
  });
}
