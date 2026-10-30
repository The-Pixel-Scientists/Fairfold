// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ctx.files.store() with a fake scanner, store and transaction: the order of
// the steps, what is written where, and the limit on stores at once.

import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { AuditEvent } from '../../audit/writer.ts';
import type { RequestAudit } from '../../context.ts';
import type { TenantTransaction } from '../../database.ts';
import { ApiError } from '../../problems.ts';
import type { FileType } from '@pixel-scientists/domain/files';

import type { Verdict } from './clamd.ts';
import type { Storage } from './storage.ts';
import { createStore } from './store.ts';
import type { StoreInput } from './types.ts';

const TENANT = '11111111-1111-4111-8111-111111111111';
const MEMBER = '22222222-2222-4222-8222-222222222222';
const FILE = '33333333-3333-4333-8333-333333333333';
const PDF_TYPE: FileType = 'application/pdf';
const pdf = Buffer.from('%PDF-1.7\nAccounts\n%%EOF');

function setup(options: { verdict?: () => Promise<Verdict>; maxStores?: number } = {}) {
  const rows: [string, Record<string, unknown>][] = [];
  const puts: { key: string; bytes: Uint8Array }[] = [];
  const events: AuditEvent[] = [];
  let failPut = false;
  const db = {
    insertInto: () => ({
      values: (values: Record<string, unknown>) => {
        rows.push(['insert', values]);
        return {
          returning: () => ({
            executeTakeFirstOrThrow: () =>
              Promise.resolve({ id: FILE, created_at: new Date('2026-10-21T10:00:00Z') }),
          }),
        };
      },
    }),
    updateTable: () => ({
      set: (values: Record<string, unknown>) => {
        rows.push(['update', values]);
        return { where: () => ({ execute: () => Promise.resolve([]) }) };
      },
    }),
  };
  const storage: Storage = {
    put: (key, bytes) => {
      if (failPut) return Promise.reject(new Error('down'));
      puts.push({ key, bytes });
      return Promise.resolve();
    },
    get: () => Promise.resolve(null),
  };
  const audit: RequestAudit = {
    record: (event) => {
      events.push(event);
      return Promise.resolve();
    },
    read: () => Promise.resolve(),
  };
  const request = {
    tx: { $extendTables: () => db } as unknown as TenantTransaction,
    tenant: TENANT,
    membershipId: MEMBER,
    audit,
  };
  const store = createStore({
    storage,
    scan: options.verdict ?? (() => Promise.resolve('clean')),
    maxStores: options.maxStores ?? 4,
  });
  const input: StoreInput = {
    name: 'Accounts 2025.pdf',
    bytes: pdf,
    allowedTypes: [PDF_TYPE],
    maxBytes: 1000,
  };
  return {
    run: (change: Partial<StoreInput> = {}) => store(request, { ...input, ...change }),
    rows,
    puts,
    events,
    failPut: () => {
      failPut = true;
    },
  };
}

describe('store', () => {
  it('refuses on size, type and extension before any row exists', async () => {
    const t = setup();
    expect(await t.run({ maxBytes: 5 })).toEqual({ refusal: 'too_large' });
    expect(await t.run({ bytes: Buffer.from('MZ not a document') })).toEqual({
      refusal: 'type_not_allowed',
    });
    expect(await t.run({ bytes: Buffer.alloc(0) })).toEqual({ refusal: 'type_not_allowed' });
    expect(await t.run({ allowedTypes: ['image/png'] })).toEqual({ refusal: 'type_not_allowed' });
    expect(await t.run({ name: 'Accounts.hta' })).toEqual({ refusal: 'wrong_extension' });
    expect(t.rows).toEqual([]);
    expect(t.events).toEqual([]);
  });

  it('never takes more than the platform limit, whatever the caller allows', async () => {
    const t = setup();
    const big = Buffer.concat([pdf, Buffer.alloc(10 * 1024 * 1024)]);
    expect(await t.run({ bytes: big, maxBytes: 100 * 1024 * 1024 })).toEqual({
      refusal: 'too_large',
    });
  });

  it('refuses a bad name without repeating it', async () => {
    const t = setup();
    const error = await t.run({ name: 'secret/jo.pdf' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    expect(JSON.stringify(error)).not.toContain('secret');
    expect((error as ApiError).detail).not.toContain('secret');
    expect(t.rows).toEqual([]);
  });

  it('stores a clean file at its own key and audits ids, type, size and verdict', async () => {
    const t = setup();
    const result = await t.run({ name: '  Accounts 2025.pdf ' });
    expect(result).toEqual({
      file: {
        id: FILE,
        name: 'Accounts 2025.pdf',
        type: PDF_TYPE,
        bytes: pdf.length,
        uploadedAt: '2026-10-21T10:00:00.000Z',
      },
    });
    expect(t.rows).toEqual([
      [
        'insert',
        {
          tenant_id: TENANT,
          name: 'Accounts 2025.pdf',
          content_type: PDF_TYPE,
          size_bytes: pdf.length,
          created_by: MEMBER,
        },
      ],
      [
        'update',
        {
          scan_state: 'clean',
          sha256: createHash('sha256').update(pdf).digest(),
          storage_key: `clean/${TENANT}/${FILE}`,
        },
      ],
    ]);
    expect(t.puts).toEqual([{ key: `clean/${TENANT}/${FILE}`, bytes: pdf }]);
    expect(t.events).toEqual([
      {
        action: 'platform.file.uploaded',
        entityId: FILE,
        changes: {
          'app.file.content_type': { after: PDF_TYPE },
          'app.file.size_bytes': { after: pdf.length },
          'app.file.scan_state': { after: 'clean' },
        },
      },
    ]);
    expect(JSON.stringify(t.events)).not.toContain('Accounts');
  });

  it.each([
    ['infected', 'infected'],
    ['error', 'not_checked'],
  ] as const)('records %s and stores nothing', async (verdict, refusal) => {
    const t = setup({ verdict: () => Promise.resolve(verdict) });
    expect(await t.run()).toEqual({ refusal });
    expect(t.rows.map(([kind]) => kind)).toEqual(['insert', 'update']);
    expect(t.rows[1]?.[1]).toEqual({ scan_state: verdict });
    expect(t.puts).toEqual([]);
    expect(t.events).toMatchObject([{ action: 'platform.file.refused', entityId: FILE }]);
    expect(t.events[0]?.changes?.['app.file.scan_state']).toEqual({ after: verdict });
  });

  it('answers 503 when storage fails, and leaves the file not clean', async () => {
    const t = setup();
    t.failPut();
    const error = await t.run().catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 503 });
    expect(t.rows.map(([kind]) => kind)).toEqual(['insert']);
    expect(t.events).toEqual([]);
  });

  it('allows only the set number of stores at once, then answers 503 with Retry-After', async () => {
    const release: (() => void)[] = [];
    const t = setup({
      maxStores: 2,
      verdict: () =>
        new Promise<Verdict>((resolve) => {
          release.push(() => {
            resolve('clean');
          });
        }),
    });
    const first = t.run();
    const second = t.run();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const third = await t.run().catch((e: unknown) => e);
    expect(third).toBeInstanceOf(ApiError);
    expect(third).toMatchObject({ status: 503, headers: { 'retry-after': '5' } });

    release.forEach((go) => {
      go();
    });
    await Promise.all([first, second]);
    // The slots are free again.
    const fourth = t.run();
    await new Promise((resolve) => setTimeout(resolve, 10));
    release.at(-1)?.();
    expect(await fourth).toHaveProperty('file');
  });

  it('frees its slot when a store fails', async () => {
    let fail = true;
    const t = setup({
      maxStores: 1,
      verdict: () => (fail ? Promise.reject(new Error('boom')) : Promise.resolve('clean')),
    });
    await expect(t.run()).rejects.toThrow('boom');
    fail = false;
    expect(await t.run()).toHaveProperty('file');
  });
});
