// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the API knows about a request once the auth module has read its
// session. The auth module fills it (S02-07); nothing in the policy or the
// handlers reads cookies or headers. The acting user and tenant come only
// from here, never from a request body or URL (architecture rule 6).

import type { TenantId } from '@pixel-scientists/db';
import type { App, Permission } from '@pixel-scientists/domain/platform';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

/** Where the session stands on MFA, as in the session the apps read. */
export type MfaState = 'enrol' | 'verify' | 'complete' | 'not_required';

export interface RequestSession {
  readonly userId: string;
  /** The app the session was created in. */
  readonly app: App;
  /** The tenant the session is active in, from a verified session. */
  readonly tenant: TenantId;
  readonly mfa: MfaState;
  /** When the user last signed in or re-authenticated, or null if they have not. */
  readonly recentAuthAt: Date | null;
  /** The account's email address, for the party module. Read it only where it is needed. */
  readonly email: () => Promise<string>;
}

export interface RequestContext {
  /** Quote this when asking for help; it is also on every log line. */
  readonly requestId: string;
  /** The app the request is for, from the host or path prefix. Null if it did not resolve. */
  readonly app: App | null;
  readonly session: RequestSession | null;
}

/** The context of a console or portal route, after the policy has let the caller in. */
export interface MemberContext extends RequestContext {
  readonly app: App;
  readonly session: RequestSession;
  readonly membership: {
    readonly id: string;
    /** What the caller's roles give in this app, from the role map. */
    readonly permissions: ReadonlySet<Permission>;
  };
}

export interface SessionRead {
  readonly app: App | null;
  readonly session: RequestSession | null;
}

/** What the API needs from the auth module. */
export interface AuthModule {
  /** Registers the auth module's hooks and anything else it needs on the app. */
  plugin: FastifyPluginAsync;
  /** The app a request is for and its live session, or none. */
  readSession(request: FastifyRequest): Promise<SessionRead>;
}
