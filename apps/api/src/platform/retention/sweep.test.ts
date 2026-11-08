// SPDX-License-Identifier: AGPL-3.0-or-later

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { retentionPolicies } from './policies.ts';
import { AUDIT_PURGE_CAP, purgeAudit, sweepTenant } from './sweep.ts';

/** A transaction whose purge returns the next of `counts`, counting each call. */
function fakeTransaction(counts: number[]) {
  let calls = 0;
  const trx = {
    selectNoFrom: () => ({
      executeTakeFirstOrThrow: () => {
        calls++;
        return Promise.resolve({ count: counts.shift() ?? 0 });
      },
    }),
    selectFrom: () => {
      throw new Error('No policy other than audit exists.');
    },
  };
  return { trx, calls: () => calls };
}

describe('the policies', () => {
  it('come from the classification map, with the audit minimum', () => {
    expect([...retentionPolicies]).toEqual([['audit', 365]]);
  });
});

describe('the audit purge', () => {
  it('calls again while a call returns the cap, and stops at the first that does not', async () => {
    const { trx, calls } = fakeTransaction([AUDIT_PURGE_CAP, AUDIT_PURGE_CAP, 40]);
    expect(await purgeAudit(trx as never, 20)).toEqual({
      deleted: 2 * AUDIT_PURGE_CAP + 40,
      calls: 3,
      remaining: false,
    });
    expect(calls()).toBe(3);
  });

  it('stops at its budget with work that may remain, and calls nothing with none left', async () => {
    const { trx, calls } = fakeTransaction(Array<number>(10).fill(AUDIT_PURGE_CAP));
    expect(await purgeAudit(trx as never, 4)).toEqual({
      deleted: 4 * AUDIT_PURGE_CAP,
      calls: 4,
      remaining: true,
    });
    expect(calls()).toBe(4);
    expect(await purgeAudit(trx as never, 0)).toEqual({ deleted: 0, calls: 0, remaining: true });
    expect(calls()).toBe(4);
  });

  it('makes one call when nothing has expired', async () => {
    const { trx, calls } = fakeTransaction([0]);
    expect(await sweepTenant(trx as never, 20)).toEqual({
      applied: [],
      audit: 0,
      remaining: false,
    });
    expect(calls()).toBe(1);
  });
});

describe('the code under the retention paths', () => {
  const files = [join(import.meta.dirname), join(import.meta.dirname, '../../worker/jobs')].flatMap(
    (dir) =>
      readdirSync(dir)
        .filter((name) => /retention|sweep|settings|policies|index/.test(name))
        .filter((name) => name.endsWith('.ts') && !name.includes('.test.'))
        .map((name) => join(dir, name)),
  );

  it('deletes and updates through the database functions only', () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/\.deleteFrom\(|\.updateTable\(|\bsql`|CompiledQuery/);
      if (!file.endsWith('settings.ts')) expect(source, file).not.toMatch(/\.insertInto\(/);
    }
  });
});
