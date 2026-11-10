// SPDX-License-Identifier: AGPL-3.0-or-later

import { scheduleProblems } from '@pixel-scientists/db/jobs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sweep: vi.fn(),
  purge: vi.fn(),
  send: vi.fn(),
  fanOut: vi.fn(),
}));
vi.mock('../../platform/retention/index.ts', () => ({
  sweepTenant: mocks.sweep,
  purgeAudit: mocks.purge,
}));
vi.mock('./fan-out.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendToEachTenant: mocks.fanOut,
}));
vi.mock('@pixel-scientists/db/jobs', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendJob: mocks.send,
}));

import { schedules } from '../schedules.ts';
import { fanOutQueue, platformHandlers } from './index.ts';
import {
  auditPurgeHandler,
  auditPurgeQueue,
  MAX_CALLS,
  MAX_STEPS,
  retentionSweepHandler,
  retentionSweepQueue,
} from './retention.ts';

const log = { error: vi.fn(), info: vi.fn() };
const context = { sender: {} as never, requestId: crypto.randomUUID(), causingUserId: null };
const slot = crypto.randomUUID();

const sweepJob = (step?: number) =>
  retentionSweepHandler(log).handle({} as never, {
    id: crypto.randomUUID(),
    data: { slot, ...(step === undefined ? {} : { step }) },
    context,
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sweep.mockResolvedValue({ applied: [], audit: 3, remaining: false });
  mocks.purge.mockResolvedValue({ deleted: 7, calls: 1, remaining: false });
});

describe('the queues', () => {
  it('are migration 0029’s, taking ids and an integer only', () => {
    expect(retentionSweepQueue).toMatchObject({ name: 'platform.retention_sweep', kind: 'tenant' });
    expect(auditPurgeQueue).toMatchObject({ name: 'platform.audit_purge', kind: 'platform' });
    const accepts = (data: object) => retentionSweepQueue.data.safeParse(data).success;
    expect(accepts({ slot })).toBe(true);
    expect(accepts({ slot, step: 2 })).toBe(true);
    for (const bad of [
      { slot, step: 0 },
      { slot, step: MAX_STEPS + 1 },
      { slot, tenantId: slot },
      { slot, table: 'app.audit_event' },
      { slot, cutoff: '2020-01-01T00:00:00Z' },
      { slot, policy: 'audit' },
      {},
    ]) {
      expect(accepts(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it('are reached nightly through one schedule, with no tenant and outside 01:00 to 02:00', () => {
    expect(scheduleProblems(schedules)).toEqual([]);
    expect(auditPurgeQueue.data.safeParse({ target: retentionSweepQueue.name }).success).toBe(true);
    expect(fanOutQueue.data.safeParse({ target: retentionSweepQueue.name }).success).toBe(false);
    expect(schedules.filter(({ queue }) => queue === auditPurgeQueue)).toEqual([
      { queue: auditPurgeQueue, cron: '30 3 * * *', data: { target: retentionSweepQueue.name } },
    ]);
    const names = platformHandlers(log).map(({ queue }) => queue.name);
    expect(names).toEqual(expect.arrayContaining([retentionSweepQueue.name, auditPurgeQueue.name]));
  });
});

describe('the tenant sweep', () => {
  it('makes a bounded number of calls and sends no continuation when nothing remains', async () => {
    await sweepJob();
    expect(mocks.sweep).toHaveBeenCalledWith(expect.anything(), MAX_CALLS);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('sends one continuation for the same slot, keyed on slot and step', async () => {
    mocks.sweep.mockResolvedValue({ applied: [], audit: 0, remaining: true });
    await sweepJob();
    await sweepJob(4);
    const [first, second] = mocks.send.mock.calls as [unknown, unknown, object, unknown, object][];
    expect(first?.[1]).toBe(retentionSweepQueue);
    expect(first?.[2]).toEqual({ slot, step: 1 });
    expect(first?.[4]).toEqual({ singletonOn: ['slot', 'step'] });
    expect(second?.[2]).toEqual({ slot, step: 5 });
  });

  it('ends the chain at its last step; the rest waits for the next night', async () => {
    mocks.sweep.mockResolvedValue({ applied: [], audit: 0, remaining: true });
    await sweepJob(MAX_STEPS);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('logs queue, policy, table and counts only', async () => {
    mocks.sweep.mockResolvedValue({
      applied: [{ policy: 'drafts', table: 'grants.draft', deleted: 2, anonymised: 1 }],
      audit: 3,
      remaining: false,
    });
    await sweepJob();
    expect(log.info.mock.calls.map(([fields]: unknown[]) => fields)).toEqual([
      expect.objectContaining({
        queue: 'platform.retention_sweep',
        policy: 'drafts',
        table: 'grants.draft',
        deleted: 2,
        anonymised: 1,
      }),
      expect.objectContaining({ policy: 'audit', table: 'app.audit_event', deleted: 3 }),
    ]);
    expect(JSON.stringify(log.info.mock.calls)).not.toContain(slot);
  });

  it('fails the job with the error, and sends nothing, when the database refuses', async () => {
    mocks.sweep.mockRejectedValue(new Error('relation "secret" does not exist'));
    await expect(sweepJob()).rejects.toThrow();
    expect(mocks.send).not.toHaveBeenCalled();
  });
});

describe('the platform job', () => {
  it('sends the tenants their sweeps, then purges sign-in events with no tenant set', async () => {
    const db = {} as never;
    const job = {
      id: crypto.randomUUID(),
      data: { target: retentionSweepQueue.name },
      context,
    };
    await auditPurgeHandler(log).handle(db, job);
    expect(mocks.fanOut).toHaveBeenCalledWith(db, job, log);
    expect(mocks.purge).toHaveBeenCalledWith(db, MAX_CALLS);
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ policy: 'audit', table: 'auth.audit_event', deleted: 7 }),
      expect.any(String),
    );
  });

  it('does not purge when a tenant’s job could not be sent, so the retry sends the rest', async () => {
    mocks.fanOut.mockRejectedValueOnce(new Error('one tenant failed'));
    const job = { id: crypto.randomUUID(), data: { target: retentionSweepQueue.name }, context };
    await expect(auditPurgeHandler(log).handle({} as never, job)).rejects.toThrow();
    expect(mocks.purge).not.toHaveBeenCalled();
  });
});
