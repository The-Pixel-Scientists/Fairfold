// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The sweep's decisions with a fake transaction and store: which objects it
// deletes, which it keeps, and where it stops. The row locks and the definer
// functions are tested against the database.

import type { Transaction } from '@pixel-scientists/db';
import { describe, expect, it } from 'vitest';

import { sweepTenant, SWEEP_LIMIT } from './sweep.ts';

const TENANT = '11111111-1111-4111-8111-111111111111';
const id = (n: number) => `33333333-3333-4333-8333-${String(n).padStart(12, '0')}`;
const NOW = Date.parse('2026-10-29T12:00:00Z');
const HOUR = 3_600_000;

/** A transaction whose lists and single rows come from queues, in the order the sweep asks. */
function fakeTransaction(lists: unknown[][], firsts: unknown[]) {
  const dropped: string[] = [];
  const chain: object = new Proxy(
    {},
    {
      get: (_target, name) => {
        if (name === 'execute') return () => Promise.resolve(lists.shift() ?? []);
        if (name === 'executeTakeFirst') return () => Promise.resolve(firsts.shift());
        if (name === 'executeTakeFirstOrThrow') return () => Promise.resolve({ deleted: true });
        return () => chain;
      },
    },
  );
  const trx = {
    $extendTables: () => chain,
    selectNoFrom: (build: (eb: unknown) => unknown) => {
      build({
        fn: () => ({ as: () => ({}) }),
        val: (value: string) => {
          dropped.push(value);
          return value;
        },
      });
      return chain;
    },
  } as unknown as Transaction<unknown>;
  return { trx, dropped };
}

function fakeRemoval(keys: string[], ages: Record<string, number | null>, versioned = false) {
  const deleted: string[] = [];
  const listed: string[] = [];
  return {
    deleted,
    listed,
    removal: {
      versioned: () => Promise.resolve(versioned),
      list: async function* (prefix: string) {
        listed.push(prefix);
        for (const key of keys.filter((found) => found.startsWith(prefix))) {
          await Promise.resolve();
          yield key;
        }
      },
      head: (key: string) => {
        const age = ages[key];
        return Promise.resolve(age === undefined || age === null ? null : new Date(NOW - age));
      },
      delete: (key: string) => {
        deleted.push(key);
        return Promise.resolve();
      },
    },
  };
}

const clean = (n: number) => `clean/${TENANT}/${id(n)}`;
const withheld = (n: number) => `withheld/${TENANT}/${id(n)}`;

describe('the sweep', () => {
  it('lists only this tenant under clean/ and withheld/', async () => {
    const { trx } = fakeTransaction([[], []], []);
    const { removal, listed } = fakeRemoval([], {});
    await sweepTenant(trx, { removal }, TENANT, () => NOW);
    expect(listed).toEqual([`clean/${TENANT}/`, `withheld/${TENANT}/`]);
  });

  it('keeps the object a row points at and an object under an hour old', async () => {
    const { trx } = fakeTransaction(
      [[], []],
      [{ storage_key: clean(1), erased_at: null }, undefined],
    );
    const { removal, deleted } = fakeRemoval([clean(1), clean(2)], {
      [clean(1)]: 5 * HOUR,
      [clean(2)]: HOUR / 2,
    });
    expect(await sweepTenant(trx, { removal }, TENANT, () => NOW)).toMatchObject({ objects: 0 });
    expect(deleted).toEqual([]);
  });

  it('deletes an old object no row points at: no row, another key, or an erased row', async () => {
    const { trx } = fakeTransaction(
      [[], []],
      [
        undefined,
        { storage_key: withheld(2), erased_at: null },
        { storage_key: null, erased_at: new Date(NOW) },
      ],
    );
    const { removal, deleted } = fakeRemoval([clean(1), clean(2), clean(3)], {
      [clean(1)]: 2 * HOUR,
      [clean(2)]: 2 * HOUR,
      [clean(3)]: 2 * HOUR,
    });
    expect(await sweepTenant(trx, { removal }, TENANT, () => NOW)).toMatchObject({ objects: 3 });
    expect(deleted).toEqual([clean(1), clean(2), clean(3)]);
  });

  it('skips an object that vanished before its HEAD, and a name that is not ours', async () => {
    const { trx } = fakeTransaction([[], []], [undefined]);
    const { removal, deleted } = fakeRemoval(
      [clean(1), `clean/${TENANT}/notes.txt`, `clean/${TENANT}/${id(2)}/extra`],
      {},
    );
    expect(await sweepTenant(trx, { removal }, TENANT, () => NOW)).toMatchObject({ objects: 0 });
    expect(deleted).toEqual([]);
  });

  it('removes a released file’s object, then its row, and counts refused rows the database allows', async () => {
    const { trx, dropped } = fakeTransaction(
      [[{ id: id(1) }], [{ id: id(2) }, { id: id(3) }]],
      [{ storage_key: withheld(1) }],
    );
    const { removal, deleted } = fakeRemoval([], {});
    const counts = await sweepTenant(trx, { removal }, TENANT, () => NOW);
    expect(deleted).toEqual([withheld(1)]);
    expect(dropped).toEqual([id(1), id(2), id(3)]);
    expect(counts).toEqual({ released: 1, refused: 2, objects: 0 });
  });

  it('refuses to run if the bucket keeps versions', async () => {
    const { trx } = fakeTransaction([], []);
    const { removal, listed } = fakeRemoval([], {}, true);
    await expect(sweepTenant(trx, { removal }, TENANT, () => NOW)).rejects.toThrow('versions');
    expect(listed).toEqual([]);
  });

  it('stops at its limit of objects', async () => {
    const keys = Array.from({ length: SWEEP_LIMIT + 5 }, (_, n) => clean(n + 1));
    const { trx } = fakeTransaction([[], []], []);
    const ages = Object.fromEntries(keys.map((key) => [key, 2 * HOUR]));
    const { removal, deleted } = fakeRemoval(keys, ages);
    await sweepTenant(trx, { removal }, TENANT, () => NOW);
    expect(deleted).toHaveLength(SWEEP_LIMIT);
  });
});
