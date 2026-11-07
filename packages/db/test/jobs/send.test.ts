// SPDX-License-Identifier: AGPL-3.0-or-later
//
// sendJob() against migration 0024: the tenant comes only from the caller's
// transaction, the job commits and rolls back with it, singleton keys are
// per tenant, and the helper refuses before the trigger does.

import { randomUUID } from 'node:crypto';

import { idSchema } from '@pixel-scientists/domain';
import type { Transaction } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { defineQueue, type Queue } from '../../src/jobs/queue.ts';
import { sendJob, type JobContext } from '../../src/jobs/send.ts';
import { trustedTenantId, withTenant } from '../../src/tenant-context.ts';
import { createTestTenant, type TestTenant } from '../tenants.ts';
import { asRoleRolledBack, REFUSED, setTenant, tryInsertJob } from './fixtures.ts';
import { jobRows, startJobsTest, stopJobsTest, type JobsTest } from './helpers.ts';

const entity = z.strictObject({ entityId: idSchema });
let test: JobsTest;
let source: Queue<typeof entity, 'tenant'>;
let platform: Queue<typeof entity, 'platform'>;
let short: Queue<typeof entity, 'tenant'>;
let a: TestTenant;
let b: TestTenant;

beforeAll(async () => {
  test = await startJobsTest();
  source = defineQueue(test.queues.source, 'tenant', entity);
  platform = defineQueue(test.queues.platform, 'platform', entity);
  short = defineQueue(test.short, 'tenant', entity);
  [a, b] = [await createTestTenant(), await createTestTenant()];
}, 30_000);
afterAll(() => stopJobsTest(test));

const context = (): JobContext => ({
  sender: test.apiSender,
  requestId: randomUUID(),
  causingUserId: randomUUID(),
});

function inTenant<T>(tenant: TestTenant, work: (trx: Transaction<unknown>) => Promise<T>) {
  return withTenant(test.api, trustedTenantId(tenant.id), work);
}

function withNoTenant<T>(work: (trx: Transaction<unknown>) => Promise<T>) {
  return test.api.transaction().execute(work);
}

describe('sendJob', () => {
  it("sends a tenant job carrying the transaction's tenant and the caller's context", async () => {
    const data = { entityId: randomUUID() };
    const ctx = context();
    const id = await inTenant(a, (trx) => sendJob(trx, source, data, ctx));
    const [row] = await jobRows('id = $1', [id]);
    expect(row?.data).toEqual({
      ...data,
      tenantId: a.id,
      requestId: ctx.requestId,
      causingUserId: ctx.causingUserId,
    });
    expect(row?.dead_letter).toBe(test.queues.dead);
    expect(test.errors).toEqual([]);
  });

  it("rolls back with the caller's transaction and commits with it", async () => {
    let sent: string | null = null;
    await expect(
      inTenant(a, async (trx) => {
        sent = await sendJob(trx, source, { entityId: randomUUID() }, context());
        throw new Error('The caller failed.');
      }),
    ).rejects.toThrow('The caller failed.');
    expect(sent).toEqual(expect.any(String));
    expect(await jobRows('id = $1', [sent])).toEqual([]);

    const committed = await inTenant(a, (trx) =>
      sendJob(trx, source, { entityId: randomUUID() }, context()),
    );
    expect(await jobRows('id = $1', [committed])).toHaveLength(1);
  });

  it('refuses a tenant queue with no tenant set, before the trigger would', async () => {
    await expect(
      withNoTenant((trx) => sendJob(trx, source, { entityId: randomUUID() }, context())),
    ).rejects.toMatchObject({ name: 'JobSendError', code: 'no_tenant' });
  });

  it('refuses a tenant id, or any reserved or unknown key, in the data', async () => {
    for (const extra of [
      { tenantId: b.id },
      { requestId: randomUUID() },
      { causingUserId: null },
      { note: 'x' },
    ]) {
      const data = { entityId: randomUUID(), ...extra } as { entityId: string };
      await expect(
        inTenant(a, (trx) => sendJob(trx, source, data, context())),
      ).rejects.toMatchObject({ code: 'invalid_payload' });
      expect(await jobRows("data->>'entityId' = $1", [data.entityId])).toEqual([]);
    }
  });

  it('refuses a queue it did not define, even one copying a defined name, and sends nothing', async () => {
    const loose = z.looseObject({});
    const forged: Queue[] = [
      { ...source },
      { name: source.name, kind: 'tenant', data: loose, payload: loose },
    ];
    const entityId = randomUUID();
    for (const queue of forged) {
      await expect(
        inTenant(a, (trx) => sendJob(trx, queue, { entityId, email: 'a@example.test' }, context())),
      ).rejects.toMatchObject({ name: 'JobSendError', code: 'invalid_options' });
    }
    expect(await jobRows("data->>'entityId' = $1", [entityId])).toEqual([]);
    expect(Object.isFrozen(source)).toBe(true);
  });

  it('refuses a request or causing user id that is not an id', async () => {
    const bad = { ...context(), requestId: 'not-a-uuid' };
    await expect(
      inTenant(a, (trx) => sendJob(trx, source, { entityId: randomUUID() }, bad)),
    ).rejects.toMatchObject({
      code: 'invalid_payload',
      message: expect.stringContaining('requestId') as unknown,
    });
  });

  it("cannot carry another tenant: the trigger refuses a crafted insert in A's context", () =>
    asRoleRolledBack('app_api', async (client) => {
      await setTenant(client, a.id);
      const data = { entityId: randomUUID(), tenantId: b.id };
      const job = { name: test.queues.source, dead_letter: test.queues.dead, data };
      expect(await tryInsertJob(client, job)).toBe(REFUSED);
    }));

  it('refuses a platform job with a tenant set, and app_api cannot send one at all', async () => {
    const data = { entityId: randomUUID() };
    await expect(
      inTenant(a, (trx) => sendJob(trx, platform, data, context())),
    ).rejects.toMatchObject({ code: 'tenant_set' });
    await expect(
      withNoTenant((trx) => sendJob(trx, platform, data, context())),
    ).rejects.toMatchObject({ code: REFUSED });
  });
});

describe('singleton keys', () => {
  it('are prefixed with the tenant, so tenant B is never suppressed by tenant A', async () => {
    const data = { entityId: randomUUID() };
    const send = (tenant: TestTenant) =>
      inTenant(tenant, (trx) =>
        sendJob(trx, short, data, context(), { singletonOn: ['entityId'] }),
      );

    const first = await send(a);
    expect(first).toEqual(expect.any(String));
    expect(await send(a)).toBeNull();
    expect(await send(b)).toEqual(expect.any(String));

    const [row] = await jobRows('id = $1', [first]);
    expect(row?.singleton_key).toBe(`${a.id}:${JSON.stringify([data.entityId])}`);
  });

  it.each([
    ['no fields', { singletonOn: [] }],
    ['a field the payload does not have', { singletonOn: ['tenantId' as 'entityId'] }],
    ['a start time that is not a date', { startAfter: new Date('never') }],
    ['a negative retry limit', { retryLimit: -1 }],
    ['a fractional retry limit', { retryLimit: 1.5 }],
  ])('refuse options with %s', async (_, options) => {
    await expect(
      inTenant(a, (trx) => sendJob(trx, short, { entityId: randomUUID() }, context(), options)),
    ).rejects.toMatchObject({ code: 'invalid_options' });
  });
});
