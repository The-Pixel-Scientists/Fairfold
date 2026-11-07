// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';

const audit = vi.hoisted(() => vi.fn());
vi.mock('../../audit/writer.ts', () => ({ recordAudit: audit }));
vi.mock('../../platform/files/index.ts', () => ({
  sweepTenant: () => Promise.resolve({ released: 3, refused: 2, objects: 5 }),
  recheckTenant: () => Promise.resolve({ restored: 4, stillWithheld: 1 }),
}));

import type { FilesJobDependencies } from '../../platform/files/index.ts';
import { filesHandler, filesQueue } from './files.ts';
import { schedules } from '../schedules.ts';
import { fanOutQueue, fileFanOutQueue, platformHandlers } from './index.ts';

describe('the tenant files job', () => {
  it('is migration 0029’s tenant queue for file work, taking a slot only', () => {
    expect(filesQueue).toMatchObject({ name: 'platform.file_scan', kind: 'tenant' });
    expect(filesQueue.data.safeParse({ slot: crypto.randomUUID() }).success).toBe(true);
    expect(filesQueue.data.safeParse({ slot: crypto.randomUUID(), tenantId: 'x' }).success).toBe(
      false,
    );
    expect(filesQueue.data.safeParse({ fileName: 'Accounts.pdf' }).success).toBe(false);
  });

  it('is reached from the daily file fan-out only, and both exist only with the file settings', () => {
    expect(fileFanOutQueue).toMatchObject({ name: 'platform.file_fan_out', kind: 'platform' });
    expect(fileFanOutQueue.data.safeParse({ target: filesQueue.name }).success).toBe(true);
    expect(fanOutQueue.data.safeParse({ target: filesQueue.name }).success).toBe(false);
    const daily = schedules.filter(({ queue }) => queue === fileFanOutQueue);
    expect(daily).toEqual([
      { queue: fileFanOutQueue, cron: '0 2 * * *', data: { target: filesQueue.name } },
    ]);
    const logger = { error: () => undefined };
    const without = platformHandlers(logger).map(({ queue }) => queue.name);
    const withFiles = platformHandlers(logger, {} as FilesJobDependencies).map(
      ({ queue }) => queue.name,
    );
    expect(without).not.toContain(filesQueue.name);
    expect(without).not.toContain(fileFanOutQueue.name);
    expect(withFiles).toEqual(expect.arrayContaining([filesQueue.name, fileFanOutQueue.name]));
  });
});

describe('the tenant files job audit', () => {
  it('records the sweep and recheck counts as numbers on the two events', async () => {
    const trx = {
      selectNoFrom: () => ({
        executeTakeFirstOrThrow: () => Promise.resolve({ id: crypto.randomUUID() }),
      }),
    };
    const context = { sender: {} as never, requestId: 'r', causingUserId: null };
    await filesHandler({} as FilesJobDependencies).handle(trx as never, {
      id: crypto.randomUUID(),
      data: { slot: crypto.randomUUID() },
      context,
    });
    type Event = { action: string; changes: Record<string, { after: unknown }> };
    const events = audit.mock.calls.map(([, , event]) => event as Event);
    expect(events.map((e) => e.action)).toEqual([
      'platform.file_sweep.completed',
      'platform.file_recheck.completed',
    ]);
    const after = (event?: Event) => Object.values(event?.changes ?? {}).map((c) => c.after);
    expect(after(events[0])).toEqual([3, 2, 5]);
    expect(after(events[1])).toEqual([4, 1]);
  });
});
