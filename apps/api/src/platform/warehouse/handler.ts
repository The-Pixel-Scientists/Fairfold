// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The warehouse snapshot route's handler (ADR 0016, D14), matched with its
// contract in apps/api/src/modules.ts. The platform has already checked the
// session and the permission. The script is built inside the request and
// its transaction, so it holds exactly what the admin's tenant holds under
// row-level security. Each download is audited with the rows in each table.

import { classification } from '@pixel-scientists/db/classification';
import {
  MAX_SNAPSHOT_BYTES,
  warehouseTables,
  type getWarehouseSnapshot,
  type WarehouseTableName,
} from '@pixel-scientists/domain/warehouse';

import { ApiError } from '../../problems.ts';
import type { Handler } from '../../routes/register.ts';
import { settingsTables } from '../settings/tables.ts';
import { SnapshotTooLarge } from './script.ts';
import { buildSnapshot, type Contribution } from './snapshot.ts';

const TOO_LARGE =
  'This snapshot is larger than 50 MB, which is more than a download can hold. Ask the operator for a copy.';

/**
 * The audit event names a table by the classified column of its key, since
 * a change is keyed by a column id: `party.organisation.id` stands for
 * `organisation`. Every table's differs.
 */
export const countField = (table: WarehouseTableName): string => {
  const { key, columns } = warehouseTables[table];
  const { from } = columns[key as keyof typeof columns] as { from: readonly string[] };
  return from[0] ?? '';
};

export function warehouseSnapshotHandler(deps: {
  readonly contributions: readonly Contribution[];
  /** For tests; the contract's limit otherwise. */
  readonly maxBytes?: number;
  readonly now?: () => Date;
}): Handler<typeof getWarehouseSnapshot> {
  return async ({ tx, context }) => {
    const tenantId = context.session.tenant;
    const row = await settingsTables(tx)
      .selectFrom('app.tenant')
      .select(['timezone', 'fiscal_year_start_month'])
      .where('id', '=', tenantId)
      .executeTakeFirstOrThrow();
    const at = (deps.now ?? (() => new Date()))();

    let built;
    try {
      built = await buildSnapshot(tx, {
        tenantId,
        tenant: { timezone: row.timezone, fiscalYearStartMonth: row.fiscal_year_start_month },
        contributions: deps.contributions,
        classification,
        at,
        maxBytes: deps.maxBytes ?? MAX_SNAPSHOT_BYTES,
      });
    } catch (error) {
      if (error instanceof SnapshotTooLarge) {
        throw new ApiError(400, TOO_LARGE, { reason: 'snapshot_too_large' });
      }
      throw error;
    }

    await context.audit.record({
      action: 'platform.warehouse.exported',
      entityId: tenantId,
      changes: Object.fromEntries(
        Object.entries(built.counts).map(([table, rows]) => [
          countField(table as WarehouseTableName),
          { before: null, after: rows },
        ]),
      ),
    });
    return {
      type: 'application/sql',
      body: built.script,
      headers: {
        'content-disposition': `attachment; filename="warehouse-snapshot-${at.toISOString().slice(0, 10)}.sql"`,
      },
    };
  };
}
