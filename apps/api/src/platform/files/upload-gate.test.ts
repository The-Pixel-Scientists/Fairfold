// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The upload gate (ADR 0030, "Upload limits"): the declared length, the
// bodies read at once, the four counters, and what the raw upload route does
// with them, against in-memory counters.

import { defineRoute } from '@pixel-scientists/domain/api';
import {
  encodeFileNameHeader,
  MAX_UPLOAD_BODIES_AT_ONCE,
  uploadLimits,
} from '@pixel-scientists/domain/files';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { testAuth, testSession } from '../../../test/support.ts';
import { buildApp } from '../../app.ts';
import { Secret } from '../../config.ts';
import type { TenantTransaction } from '../../database.ts';
import type { UploadCounters } from '../../limits/store.ts';
import { createLogger } from '../../logger.ts';
import { route } from '../../routes/register.ts';
import { uploadGate } from './upload-gate.ts';

const KEY = new Secret('a-test-key-of-at-least-32-bytes-long');
const MEMBER = '22222222-2222-4222-8222-222222222222';

/** Counters in memory, with the same rule as the table: add only within the maximum. */
function counters(fail = false) {
  const counts = new Map<string, number>();
  const calls: string[] = [];
  const id = (bucket: string, hash: Buffer) => `${bucket}:${hash.toString('hex')}`;
  const store: UploadCounters = {
    add: (bucket, hash, _window, amount, max) => {
      calls.push(`add ${bucket}`);
      if (fail && bucket === 'upload_bytes_membership') return Promise.reject(new Error('down'));
      const now = counts.get(id(bucket, hash)) ?? 0;
      if (now + amount > max) return Promise.resolve({ charged: false, retryAfter: 90 });
      counts.set(id(bucket, hash), now + amount);
      return Promise.resolve({ charged: true });
    },
    subtract: (bucket, hash, _window, amount) => {
      counts.set(id(bucket, hash), Math.max(0, (counts.get(id(bucket, hash)) ?? 0) - amount));
      return Promise.resolve();
    },
  };
  const total = () => [...counts.values()].reduce((sum, count) => sum + count, 0);
  return { store, counts, calls, total };
}

const request = (ip: string, length: string | null = '1000') => ({
  ip,
  headers: length === null ? {} : { 'content-length': length },
});

describe('the upload gate', () => {
  it('answers 411 without a declared length, before any counter', async () => {
    const c = counters();
    const gate = uploadGate({ store: c.store, key: KEY });
    for (const length of [null, 'abc', '-1', '1e3']) {
      await expect(gate.admit(request('203.0.113.1', length), MEMBER)).rejects.toMatchObject({
        status: 411,
      });
    }
    expect(c.calls).toEqual([]);
  });

  it('answers 413 before any counter when the declared length is over the limit', async () => {
    const c = counters();
    const gate = uploadGate({ store: c.store, key: KEY });
    await expect(gate.admit(request('203.0.113.1', '999999999'), MEMBER)).rejects.toMatchObject({
      status: 413,
    });
    await expect(gate.admit(request('203.0.113.1', '1001'), MEMBER, 1000)).rejects.toMatchObject({
      status: 413,
    });
    expect(c.calls).toEqual([]);
    await gate.admit(request('203.0.113.1', '1000'), MEMBER, 1000);
  });

  it('charges one file and the declared bytes to the membership and the address', async () => {
    const c = counters();
    const gate = uploadGate({ store: c.store, key: KEY });
    await gate.admit(request('203.0.113.1', '5000'), MEMBER);
    expect(c.calls).toEqual([
      'add upload_files_membership',
      'add upload_bytes_membership',
      'add upload_files_address',
      'add upload_bytes_address',
    ]);
    expect([...c.counts.values()].sort((a, b) => a - b)).toEqual([1, 1, 5000, 5000]);
  });

  it('counts an IPv6 address by its /64 and a membership apart from an address', async () => {
    const c = counters();
    const gate = uploadGate({ store: c.store, key: KEY });
    await gate.admit(request('2001:db8:1:2::1'), MEMBER);
    await gate.admit(request('2001:db8:1:2:ffff::9'), '33333333-3333-4333-8333-333333333333');
    // Same /64: the address buckets hold both uploads; each membership holds one.
    expect([...c.counts.values()].sort((a, b) => a - b)).toEqual([1, 1, 2, 1000, 1000, 2000]);
  });

  it('answers 429 with Retry-After and when to try again, charging nothing', async () => {
    const c = counters();
    const gate = uploadGate({ store: c.store, key: KEY });
    const limit = uploadLimits.upload_files_membership.max;
    for (let i = 0; i < limit; i++) {
      (await gate.admit(request('203.0.113.1', '1'), MEMBER)).bodyRead();
    }
    const before = c.total();
    const refused = await gate.admit(request('203.0.113.2', '1'), MEMBER).catch((e: unknown) => e);
    expect(refused).toMatchObject({
      status: 429,
      detail: 'You have uploaded as many files as you can for now. Try again in 2 minutes.',
      headers: { 'retry-after': '90' },
    });
    expect(c.total()).toBe(before);
  });

  it('gives back what it had charged when a later counter refuses', async () => {
    const c = counters();
    const gate = uploadGate({ store: c.store, key: KEY });
    const max = uploadLimits.upload_bytes_membership.max;
    // A route limit above the bucket's, so one declared length can nearly fill it.
    await gate.admit(request('203.0.113.1', String(max - 10)), MEMBER, max);
    const before = c.total();
    await expect(gate.admit(request('203.0.113.1', '11'), MEMBER, max)).rejects.toMatchObject({
      status: 429,
    });
    expect(c.total()).toBe(before);
  });

  it('gives the charge back on a refund, as for a replay', async () => {
    const c = counters();
    const gate = uploadGate({ store: c.store, key: KEY });
    const admission = await gate.admit(request('203.0.113.1', '4000'), MEMBER);
    await admission.refund();
    expect(c.total()).toBe(0);
  });

  it('answers 503 with Retry-After if the counters fail, and gives back what it charged', async () => {
    const c = counters(true);
    const gate = uploadGate({ store: c.store, key: KEY });
    await expect(gate.admit(request('203.0.113.1'), MEMBER)).rejects.toMatchObject({
      status: 503,
      headers: { 'retry-after': '5' },
    });
    expect(c.total()).toBe(0);
  });

  it('reads at most 16 bodies at once and answers 503 before charging the 17th', async () => {
    const c = counters();
    const gate = uploadGate({ store: c.store, key: KEY });
    const admissions = [];
    for (let i = 0; i < MAX_UPLOAD_BODIES_AT_ONCE; i++) {
      admissions.push(await gate.admit(request(`198.51.100.${String(i)}`, '1'), MEMBER));
    }
    const calls = c.calls.length;
    await expect(gate.admit(request('198.51.100.99', '1'), MEMBER)).rejects.toMatchObject({
      status: 503,
      headers: { 'retry-after': '5' },
    });
    expect(c.calls).toHaveLength(calls);
    admissions[0]?.bodyRead();
    admissions[0]?.bodyRead();
    await gate.admit(request('198.51.100.98', '1'), MEMBER);
    await expect(gate.admit(request('198.51.100.97', '1'), MEMBER)).rejects.toMatchObject({
      status: 503,
    });
  });

  it('frees its place when a refusal happens too', async () => {
    const c = counters(true);
    const gate = uploadGate({ store: c.store, key: KEY });
    for (let i = 0; i < MAX_UPLOAD_BODIES_AT_ONCE + 2; i++) {
      await expect(gate.admit(request('203.0.113.1'), MEMBER)).rejects.toMatchObject({
        status: 503,
      });
    }
    expect(c.calls.length).toBeGreaterThan(MAX_UPLOAD_BODIES_AT_ONCE);
  });
});

const upload = defineRoute({
  method: 'POST',
  path: '/console/gate-check',
  audience: 'console',
  module: 'platform',
  permission: 'platform.settings.manage',
  scope: 'tenant',
  summary: 'Take a file',
  body: { raw: ['application/octet-stream'], maxBytes: 1000 },
  responses: { 200: z.object({ ok: z.boolean() }) },
});

/** A transaction whose every query answers `row`: enough for the policy's membership lookup. */
const answering = (row: unknown): TenantTransaction => {
  const chain: object = new Proxy(
    {},
    {
      get: (_target, name) =>
        name === 'executeTakeFirst' ? () => Promise.resolve(row) : () => chain,
    },
  );
  return { $extendTables: () => chain } as unknown as TenantTransaction;
};

describe('a raw upload route behind the gate', () => {
  const apps: FastifyInstance[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function build() {
    const auth = testAuth();
    const c = counters();
    const handler = vi.fn(() => Promise.resolve({ ok: true }));
    const app = await buildApp({
      logger: createLogger({ level: 'silent' }),
      checkDatabase: () => Promise.resolve(),
      inTenant: (_tenant, work) => work(answering({ id: MEMBER, roles: ['tenant_admin'] })),
      auth: auth.module,
      uploads: uploadGate({ store: c.store, key: KEY }),
      routes: [route(upload, handler)],
    });
    apps.push(app);
    const headers = auth.as({ app: 'console', session: testSession({ app: 'console' }) });
    const post = (extra: Record<string, string> = {}, signedIn = true) =>
      app.inject({
        method: 'POST',
        url: '/api/console/gate-check',
        headers: {
          ...(signedIn ? headers : {}),
          'content-type': 'application/octet-stream',
          'file-name': encodeFileNameHeader('Accounts.pdf'),
          ...extra,
        },
        payload: Buffer.from('%PDF-1.7'),
      });
    return { post, c, handler };
  }

  it('charges a permitted upload by its length, and hands the handler the bytes', async () => {
    const { post, c, handler } = await build();
    expect((await post()).statusCode).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
    expect([...c.counts.values()].sort((a, b) => a - b)).toEqual([1, 1, 8, 8]);
  });

  it('charges nothing to a caller who is signed out', async () => {
    const { post, c, handler } = await build();
    expect((await post({}, false)).statusCode).toBe(401);
    expect(c.calls).toEqual([]);
    expect(handler).not.toHaveBeenCalled();
  });
});
