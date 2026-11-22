// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Replay (ADR 0034): an operator moves one consumer's cursor back, inside
// the tenant's own context, so the next relay redelivers from there. The
// operator command resolves the tenant; nothing here reads it from a request.
// The database holds the same limits (migration 0098): a replay moves a
// cursor only back, and never before the oldest event kept. A refusal
// changes nothing and writes no audit event. The audit event names the
// consumer and the cursor before and after, never an event's contents.

import { asOperator, withTenant, type Kysely, type TenantId } from '@pixel-scientists/db';
import { z } from 'zod';

import { recordAudit } from '../../audit/writer.ts';
import { consumerCode } from './consumers.ts';
import { lockCursor, moveCursor, oldestKept } from './cursors.ts';

export type ReplayRefusal =
  | 'unknown_consumer'
  | 'invalid_start'
  | 'tenant_inactive'
  | 'no_cursor'
  | 'before_retained'
  | 'beyond_cursor';

export type ReplayResult =
  | { readonly ok: true; readonly from: number; readonly to: number }
  | { readonly ok: false; readonly code: ReplayRefusal };

const refuse = (code: ReplayRefusal): ReplayResult => ({ ok: false, code });

/**
 * Redeliver `consumer`'s events from number `from` up to its cursor.
 * Refuses an unknown consumer, a `from` that is not a whole number from 1, a
 * tenant that is not active, a consumer with no cursor, a `from` older than
 * the oldest event kept, and a `from` beyond the cursor.
 */
export async function replayConsumer(
  db: Kysely<unknown>,
  tenant: TenantId,
  request: { readonly consumer: string; readonly from: number; readonly requestId: string },
): Promise<ReplayResult> {
  const consumer = consumerCode.safeParse(request.consumer);
  if (!consumer.success) return refuse('unknown_consumer');
  const from = z.int().positive().safeParse(request.from);
  if (!from.success) return refuse('invalid_start');
  return withTenant(db, tenant, async (trx) => {
    const active = await trx
      .selectNoFrom((eb) => eb.fn<string>('app.tenant_ids', []).as('id'))
      .execute();
    if (!active.some(({ id }) => id === tenant)) return refuse('tenant_inactive');
    return asOperator<unknown, ReplayResult>(async (operator) => {
      const cursor = await lockCursor(operator, consumer.data);
      if (cursor === undefined) return refuse('no_cursor');
      const oldest = await oldestKept(operator);
      if (oldest === null || from.data < oldest) return refuse('before_retained');
      if (from.data > cursor.last) return refuse('beyond_cursor');
      await moveCursor(operator, consumer.data, from.data - 1);
      await recordAudit(
        operator,
        { kind: 'operator', requestId: request.requestId },
        {
          action: 'platform.event_cursor.rewound',
          entityId: cursor.id,
          changes: {
            'app.event_cursor.consumer': { after: consumer.data },
            'app.event_cursor.last_sequence': { before: cursor.last, after: from.data - 1 },
          },
        },
      );
      return { ok: true, from: from.data, to: cursor.last };
    })(trx);
  });
}
