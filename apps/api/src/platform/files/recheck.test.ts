// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The withheld recheck's decisions with a fake transaction and store. The
// row lock and the state trigger are tested against the database.

import { createHash } from 'node:crypto';

import type { Transaction } from '@pixel-scientists/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { JobActor } from '../../audit/writer.ts';
import type { Verdict } from './clamd.ts';
import { recheckTenant } from './recheck.ts';

const recorded = vi.hoisted(() => [] as unknown[]);
vi.mock('../../audit/writer.ts', () => ({
  recordAudit: (_trx: unknown, _actor: unknown, event: unknown) => {
    recorded.push(event);
    return Promise.resolve();
  },
}));

const TENANT = '11111111-1111-4111-8111-111111111111';
const FILE = '33333333-3333-4333-8333-333333333333';
const bytes = Buffer.from('%PDF-1.4\n% Accounts\n%%EOF\n');
const hash = createHash('sha256').update(bytes).digest();
const WITHHELD = `withheld/${TENANT}/${FILE}`;
const actor: JobActor = { kind: 'job', jobId: FILE, originMembershipId: null };

function setup(options: {
  verdict?: Verdict;
  version?: number | null;
  due?: unknown[];
  locked?: unknown;
  object?: Buffer | null;
}) {
  const updates: Record<string, unknown>[] = [];
  const puts: string[] = [];
  const chain: object = new Proxy(
    {},
    {
      get: (_target, name) => {
        if (name === 'execute') return () => Promise.resolve(options.due ?? []);
        if (name === 'executeTakeFirst') return () => Promise.resolve(options.locked);
        if (name === 'set') {
          return (values: Record<string, unknown>) => {
            updates.push(values);
            return chain;
          };
        }
        return () => chain;
      },
    },
  );
  const trx = { $extendTables: () => chain } as unknown as Transaction<unknown>;
  const object = options.object === undefined ? bytes : options.object;
  const deps = {
    scanner: {
      get: () => Promise.resolve(object === null ? null : new Response(object).body),
    },
    restore: {
      put: (key: string) => {
        puts.push(key);
        return Promise.resolve();
      },
    },
    scan: () => Promise.resolve(options.verdict ?? 'clean'),
    version: () => Promise.resolve(options.version === undefined ? 300 : options.version),
  };
  return { run: () => recheckTenant(trx, deps, TENANT, actor), updates, puts };
}

const due = [{ id: FILE, storage_key: WITHHELD, sha256: hash }];
const locked = { storage_key: WITHHELD, sha256: hash };

beforeEach(() => {
  recorded.length = 0;
});

describe('the withheld recheck', () => {
  it('restores a file that now scans clean, to its clean key, and records it', async () => {
    const t = setup({ due, locked });
    expect(await t.run()).toEqual({ restored: 1, stillWithheld: 0 });
    expect(t.puts).toEqual([`clean/${TENANT}/${FILE}`]);
    expect(t.updates).toEqual([
      { scan_state: 'clean', storage_key: `clean/${TENANT}/${FILE}`, scan_version: 300 },
    ]);
    expect(recorded).toMatchObject([{ action: 'platform.file.restored', entityId: FILE }]);
  });

  it('records the new version and keeps a file withheld on a match', async () => {
    const t = setup({ due, locked, verdict: 'infected' });
    expect(await t.run()).toEqual({ restored: 0, stillWithheld: 1 });
    expect(t.updates).toEqual([{ scan_version: 300 }]);
    expect(t.puts).toEqual([]);
    expect(recorded).toEqual([]);
  });

  it('changes nothing on a scanner error, an unknown version, a missing or changed object', async () => {
    for (const options of [
      { verdict: 'error' as const },
      { version: null },
      { object: null },
      { object: Buffer.from('%PDF-1.4\n% Changed\n%%EOF\n') },
    ]) {
      const t = setup({ due, locked, ...options });
      expect(await t.run()).toEqual({ restored: 0, stillWithheld: 0 });
      expect(t.updates).toEqual([]);
      expect(t.puts).toEqual([]);
    }
  });

  it('writes nothing when the row changed or was erased since the bytes were read', async () => {
    for (const row of [
      undefined,
      { storage_key: `clean/${TENANT}/${FILE}`, sha256: hash },
      { storage_key: WITHHELD, sha256: createHash('sha256').update('other').digest() },
    ]) {
      const t = setup({ due, locked: row });
      expect(await t.run()).toEqual({ restored: 0, stillWithheld: 0 });
      expect(t.puts).toEqual([]);
      expect(t.updates).toEqual([]);
    }
  });
});
