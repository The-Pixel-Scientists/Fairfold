// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomUUID } from 'node:crypto';

import { classification } from '@pixel-scientists/db/classification';
import { warehouseTableNames } from '@pixel-scientists/domain/warehouse';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../problems.ts';
import { countField, warehouseSnapshotHandler } from './handler.ts';
import type { Contribution } from './snapshot.ts';

describe('countField', () => {
  it('names each table by a different classified column that keeps its value in the audit log', () => {
    const fields = warehouseTableNames.map(countField);

    expect(new Set(fields).size).toBe(fields.length);
    for (const field of fields) {
      const dot = field.lastIndexOf('.');
      const column = classification[field.slice(0, dot)]?.[field.slice(dot + 1)];
      expect(['public', 'internal'], field).toContain(column?.sensitivity);
    }
  });
});

describe('warehouseSnapshotHandler', () => {
  const tenant = randomUUID();
  const record = vi.fn();
  /** A transaction that answers the tenant query, and a context that records audit events. */
  const call = (handler: ReturnType<typeof warehouseSnapshotHandler>) =>
    handler({
      tx: {
        $extendTables: () => ({
          selectFrom: () => ({
            select: () => ({
              where: () => ({
                executeTakeFirstOrThrow: () =>
                  Promise.resolve({ timezone: 'Europe/London', fiscal_year_start_month: 4 }),
              }),
            }),
          }),
        }),
      },
      context: { session: { tenant }, audit: { record } },
      input: {},
    } as never);

  const rows = Array.from({ length: 50 }, () => ({
    id: randomUUID(),
    status: 'active',
    name: 'Northfield Allotment Society',
    legal_form: 'charity',
    website: null,
    org_id: null,
    org_id_verified: null,
    created_at: '2026-10-01T10:00:00.000Z',
  }));
  const feeds = (list: readonly Record<string, unknown>[]): Contribution[] => [
    {
      module: 'party',
      tables: { organisation: () => Promise.resolve(list), person: () => Promise.resolve([]) },
    },
    {
      module: 'grants',
      tables: Object.fromEntries(
        ['programme', 'commitment', 'grants_round', 'grants_application', 'grants_score'].map(
          (name) => [name, () => Promise.resolve([])],
        ),
      ),
    },
  ];

  it('refuses a snapshot past the limit in plain words, and records nothing', async () => {
    record.mockClear();
    const handler = warehouseSnapshotHandler({ contributions: feeds(rows), maxBytes: 2_000 });

    const refused = await call(handler).catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(ApiError);
    expect(refused).toMatchObject({ status: 400 });
    expect((refused as ApiError).detail).toMatch(/50 MB.*operator/);
    expect(record).not.toHaveBeenCalled();
  });

  it('answers the script as SQL and records the export once built', async () => {
    record.mockClear();
    const handler = warehouseSnapshotHandler({
      contributions: feeds(rows),
      now: () => new Date('2026-10-23T09:30:00.000Z'),
    });

    const reply = await call(handler);

    expect(reply).toMatchObject({
      type: 'application/sql',
      headers: {
        'content-disposition': 'attachment; filename="warehouse-snapshot-2026-10-23.sql"',
      },
    });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'platform.warehouse.exported',
        entityId: tenant,
        changes: expect.objectContaining({
          [countField('organisation')]: { before: null, after: 50 },
        }) as object,
      }),
    );
  });
});
