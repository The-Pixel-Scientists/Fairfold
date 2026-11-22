// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A snapshot holds only classified fields (architecture rule 5, ADR 0031):
// every field of the normalised result has a class, and every column the
// store writes is in the classification map, with the class the contract
// gives its field.

import { classification } from '@pixel-scientists/db/classification';
import { describe, expect, it } from 'vitest';

import {
  registryResultClassification,
  registryResultSchema,
  type RegistryResult,
} from '../../contracts/index.ts';
import { insertSnapshot, type Tx } from './store.ts';

/** A transaction that records the columns each insert writes, and reads and writes nothing. */
function recording() {
  const written: Record<string, string[]> = {};
  const insertable = (table: string): unknown =>
    new Proxy(
      {},
      {
        get: (_, method: string) => {
          if (method === 'values') {
            return (values: unknown) => {
              const eb = { fn: () => 'tenant' };
              const rows = (
                typeof values === 'function' ? (values as (eb: unknown) => unknown)(eb) : values
              ) as Record<string, unknown> | Record<string, unknown>[];
              written[table] = Object.keys([rows].flat()[0] ?? {});
              return insertable(table);
            };
          }
          if (method === 'executeTakeFirstOrThrow') return () => Promise.resolve({ id: 'row' });
          if (method === 'execute') return () => Promise.resolve([]);
          return () => insertable(table);
        },
      },
    );
  const tx = {
    $extendTables: () => ({ insertInto: insertable }),
  } as unknown as Tx;
  return { tx, written };
}

const found: RegistryResult = registryResultSchema.parse({
  registry: 'charity_commission',
  identifier: '1999001',
  fetchedAt: '2026-11-18T10:00:00.000Z',
  status: 'registered',
  registeredName: 'Invented Community Trust',
  registeredAddress: {
    line1: '1 Invented Street',
    line2: null,
    town: 'Testtown',
    postcode: 'ZZ1 1ZZ',
    countryCode: 'GB',
  },
  registeredOn: '1999-04-02',
  removedOn: null,
  accounts: {
    periodEnd: '2025-03-31',
    income: { amountMinor: 100, currency: 'GBP' },
    expenditure: null,
  },
  accountsOverdue: null,
  officers: [{ name: 'Invented Trustee One', role: 'trustee' }],
});

describe('classification', () => {
  it('gives every field of the normalised result a class', () => {
    expect(Object.keys(registryResultClassification).sort()).toEqual(
      Object.keys(registryResultSchema.shape).sort(),
    );
  });

  it('writes only classified columns of the snapshot and officer tables', async () => {
    const { tx, written } = recording();
    await insertSnapshot(tx, 'organisation', 'charity_commission', '1999001', found);
    for (const table of ['assure.lookup_snapshot', 'assure.lookup_officer']) {
      const columns = written[table] ?? [];
      expect(columns.length).toBeGreaterThan(3);
      expect(columns.filter((column) => classification[table]?.[column] === undefined)).toEqual([]);
    }
  });

  it("writes an address into the columns classified personal, as the contract's result does", async () => {
    const { tx, written } = recording();
    await insertSnapshot(tx, 'organisation', 'charity_commission', '1999001', found);
    const addressColumns = (written['assure.lookup_snapshot'] ?? []).filter((column) =>
      column.startsWith('address_'),
    );
    expect(addressColumns.length).toBe(5);
    for (const column of addressColumns) {
      expect(classification['assure.lookup_snapshot']?.[column]?.sensitivity).toBe('personal');
    }
    expect(registryResultClassification.registeredAddress).toBe('personal');
    expect(classification['assure.lookup_officer']?.['name']?.sensitivity).toBe('personal');
    expect(registryResultClassification.officers).toBe('personal');
  });
});
