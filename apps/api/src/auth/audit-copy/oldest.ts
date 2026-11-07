// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The age of the oldest pending auth audit copy, for the telemetry gauge
// (ADR 0010, "Audit"): whole seconds, 0 when none waits, read as app_auth in
// one query on the pending copies' time index. The gauge calls it once per
// collection; a failure leaves the gauge unreported and logs a code only.

import type { Kysely } from '@pixel-scientists/db';
import type { FastifyBaseLogger } from 'fastify';

import type { AuthTables } from '../tables.ts';

export function oldestPendingCopy(
  auth: Kysely<unknown>,
  log: FastifyBaseLogger,
): () => Promise<number | undefined> {
  const db = auth.$extendTables<AuthTables>();
  return async () => {
    try {
      const { oldest, now } = await db
        .selectFrom('auth.audit_copy_pending')
        .select((eb) => [
          eb.fn.min<Date | null>('created_at').as('oldest'),
          eb.fn<Date>('now').as('now'),
        ])
        .executeTakeFirstOrThrow();
      if (oldest === null) return 0;
      return Math.max(0, Math.floor((now.getTime() - oldest.getTime()) / 1000));
    } catch {
      log.error({ code: 'audit_copy_age_unread' }, 'The oldest pending audit copy was not read');
      return undefined;
    }
  };
}
