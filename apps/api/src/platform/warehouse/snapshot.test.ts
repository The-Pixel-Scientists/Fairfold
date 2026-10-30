// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomUUID } from 'node:crypto';

import { classification } from '@pixel-scientists/db/classification';
import { warehouseTableNames, type WarehouseTenant } from '@pixel-scientists/domain/warehouse';
import { describe, expect, it, vi } from 'vitest';

import type { TenantTransaction } from '../../database.ts';
import { buildSnapshot, type Contribution } from './snapshot.ts';

const tx = {} as TenantTransaction;
const tenant: WarehouseTenant = { timezone: 'Europe/London', fiscalYearStartMonth: 4 };

type Reader = () => Promise<readonly Record<string, unknown>[]>;

const empty: Reader = () => Promise.resolve([]);

/** Contributions that feed every table with no rows, unless a reader is given. */
function contributions(readers: Partial<Record<string, Reader>> = {}) {
  const feed = (names: string[]) =>
    Object.fromEntries(names.map((name) => [name, readers[name] ?? empty]));
  return [
    { module: 'party', tables: feed(['organisation', 'person']) },
    {
      module: 'grants',
      tables: feed([
        'programme',
        'commitment',
        'grants_round',
        'grants_application',
        'grants_score',
      ]),
    },
  ] satisfies Contribution[];
}

const build = (list: readonly Contribution[]) =>
  buildSnapshot(tx, {
    tenantId: randomUUID(),
    tenant,
    contributions: list,
    classification,
    at: new Date('2026-10-23T09:30:00.000Z'),
    maxBytes: 1024 * 1024,
  });

describe('buildSnapshot', () => {
  it('writes every table of the model, in its order', async () => {
    const { script, counts } = await build(contributions());

    expect(Object.keys(counts)).toEqual(warehouseTableNames);
    expect([...script.matchAll(/^CREATE TABLE "(\w+)"/gm)].map((match) => match[1])).toEqual(
      warehouseTableNames,
    );
  });

  it("builds the date table from the commitments' days, with the tenant's fiscal year", async () => {
    const commitment = (committed_on: string) => ({
      id: randomUUID(),
      programme_id: randomUUID(),
      organisation_id: randomUUID(),
      amount_minor: 1_000,
      currency: 'GBP',
      committed_on,
    });
    const read = vi.fn(() => Promise.resolve([commitment('2026-03-31'), commitment('2026-04-02')]));

    const { script, counts } = await build(contributions({ commitment: read }));

    expect(read).toHaveBeenCalledWith(tx, tenant);
    expect(counts['date']).toBe(3);
    expect(script).toContain('2026-03-31\t2026\t1\t3\t2025\t4\n');
    expect(script).toContain('2026-04-01\t2026\t2\t4\t2026\t1\n');
    expect(script).toContain('2026-04-02\t2026\t2\t4\t2026\t1\n');
  });

  it('reads a table only from the module that owns it', async () => {
    const stray = vi.fn(() => Promise.resolve([]));
    const [party, grants] = contributions();

    await build([
      { module: 'party', tables: { ...party?.tables, programme: stray } },
      grants as Contribution,
    ]);

    expect(stray).not.toHaveBeenCalled();
  });

  it('fails when a module that owns a table feeds nothing', async () => {
    const [party] = contributions();
    await expect(build([party as Contribution])).rejects.toThrow(
      /No module feeds the warehouse table programme/,
    );
  });
});
