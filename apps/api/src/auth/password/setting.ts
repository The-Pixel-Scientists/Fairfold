// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Turning the breached-password check off or on is audited (ADR 0010). At
// start-up the API compares the setting with the last one recorded in
// auth.audit_event, as app_auth, and records password_check_setting_changed
// with the new value, on or off, and no user or tenant: the operator made
// the change. With nothing recorded the check counts as on, its default.
// Instances starting together take turns, so one change is one event.

import { randomUUID } from 'node:crypto';

import type { Kysely } from '@pixel-scientists/db';

import { recordAuthEvent } from '../events.ts';
import type { AuthTables } from '../tables.ts';

const CODE = 'password_check_setting_changed';

/** Record the setting if it differs from the last one recorded. True if it did. */
export function recordBreachCheckSetting(auth: Kysely<unknown>, on: boolean): Promise<boolean> {
  const value = on ? 'on' : 'off';
  return auth.transaction().execute(async (trx) => {
    const db = trx.$extendTables<AuthTables>();
    await db
      .selectNoFrom((eb) =>
        eb.fn('pg_advisory_xact_lock', [eb.fn('hashtext', [eb.val(CODE)])]).as('locked'),
      )
      .execute();
    const last = await db
      .selectFrom('auth.audit_event')
      .select('reason')
      .where('code', '=', CODE)
      .orderBy('occurred_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    if ((last?.reason ?? 'on') === value) return false;
    await recordAuthEvent(trx, CODE, { requestId: randomUUID(), reason: value });
    return true;
  });
}
