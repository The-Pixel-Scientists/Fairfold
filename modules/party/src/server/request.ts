// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the party server's in-process contract for crm runs in: the caller's
// request transaction and the session's member. Neither the tenant nor the
// acting member is ever an argument beside it.

import type { PartyAudit } from './handlers.ts';
import type { Tx } from './tables.ts';

/** The request a merge or a duplicate search runs in. */
export interface PartyRequest {
  readonly tx: Tx;
  readonly audit: PartyAudit;
  /** The deciding member, from the session. */
  readonly membership: { readonly id: string };
}
