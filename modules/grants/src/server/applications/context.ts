// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the application handlers read from the platform (ADR 0016). The
// platform has already checked the session, the permission and the scope
// rule. The acting person comes from the session alone, never from a request.

import type { AuditChanges } from '@pixel-scientists/db';
import type { PartyAuditAction } from '@pixel-scientists/party/contracts';

import type { GrantsAuditAction } from '../../contracts/index.ts';
import type { GrantsDependencies } from '../programme/context.ts';
import type { Tx } from '../programme/tables.ts';

export type ApplicationDependencies = Pick<GrantsDependencies, 'notFound' | 'refuse'>;

/** What a handler reads from the request context. */
export interface ApplicationContext {
  readonly audit: {
    record(event: {
      readonly action: GrantsAuditAction | PartyAuditAction;
      readonly entityId: string;
      readonly changes?: AuditChanges;
    }): Promise<void>;
  };
  readonly session: { readonly userId: string; readonly email: () => Promise<string> };
  readonly membership: { readonly id: string };
}

export interface ApplicationArgs<I> {
  readonly tx: Tx;
  readonly context: ApplicationContext;
  readonly input: I;
}

export interface ApplicationParams {
  readonly params: { readonly applicationId: string };
}
