// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The one database call behind the public unsubscribe (ADR 0033, ADR 0019):
// party.record_unsubscribe(), the approved definer function. It resolves the
// tenant from the ids it is given, so no tenant is set on the connection, and
// it answers with a fixed code only. The ids come from a verified token, never
// from the request, and every value is a bound parameter.

import type { Kysely } from '@pixel-scientists/db';

import type { UnsubscribeTarget } from '../../email/unsubscribe-token.ts';

export interface UnsubscribeStore {
  /** The function's code: `unsubscribed`, `already_unsubscribed` or `refused`. */
  record(target: UnsubscribeTarget, requestId: string): Promise<string>;
}

export const unsubscribeStoreOn = (db: Kysely<unknown>): UnsubscribeStore => ({
  async record(target, requestId) {
    const { address } = target;
    const row = await db
      .selectNoFrom((eb) =>
        eb
          .fn<string>('party.record_unsubscribe', [
            eb.val(target.tenantId),
            eb.val(target.personId),
            eb.val(target.purpose),
            eb.val(target.channel),
            eb.val(address?.hash ?? null),
            eb.val(address?.keyVersion ?? null),
            eb.val(requestId),
          ])
          .as('code'),
      )
      .executeTakeFirstOrThrow();
    return row.code;
  },
});
