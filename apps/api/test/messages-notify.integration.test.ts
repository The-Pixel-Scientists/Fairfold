// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Telling an applicant a message is waiting (ADR 0009, ADR 0033): a funder
// message queues one outbox row and one job in its own transaction, and the
// worker sends a fixed email with no message text, as app_worker in the
// payload's tenant. Rows hold ids only, a failure is only a code, and delivery
// is at least once.

import { randomUUID } from 'node:crypto';

import { createDatabase, withTenant } from '@pixel-scientists/db';
import { startWorker, stopWorker, type WorkerRunner } from '@pixel-scientists/db/jobs';
import { sendStaffMessage } from '@pixel-scientists/grants/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { trustedTenantId } from '../../../packages/db/src/tenant-context.ts';
import { connectionSettings, databaseSettings } from '../../../packages/db/test/connect.ts';
import { composeModules } from '../src/modules.ts';
import { jobLogger } from '../src/worker/job-logger.ts';
import { workerModuleJobs } from '../src/worker/module-jobs.ts';
import { handlerRegistry } from '../src/worker/registry.ts';
import { switchModule } from './modules-on.ts';
import { addMember, type Member } from './settings-api.ts';
import { MESSAGE, REPLY, startMessagesApi, type MessagesApi } from './messages-api.ts';

vi.setConfig({ testTimeout: 60_000 });

let t: MessagesApi;
let api: ReturnType<typeof createDatabase<unknown>>;
let runner: WorkerRunner | undefined;

beforeAll(async () => {
  t = await startMessagesApi('41122');
  const settings = databaseSettings('app_api', 2);
  api = createDatabase<unknown>({
    host: settings.host,
    port: settings.port,
    database: settings.database,
    password: settings.password,
    role: 'app_api',
    maxConnections: 2,
    applicationName: 'tps-db-tests',
  });
  // Earlier test files leave jobs behind; a worker would work through them first.
  await t.rows("DELETE FROM pgboss.job WHERE name = 'grants.message_notification'");
}, 60_000);

afterAll(async () => {
  if (runner !== undefined) await stopWorker(runner, 5_000);
  // Leave no waiting job for a worker started by a later test file to send.
  await t.rows("DELETE FROM pgboss.job WHERE name = 'grants.message_notification'");
  await api.destroy();
  await t.close();
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Every leaf of a payload, which must hold ids and nothing else. */
const leaves = (value: unknown): unknown[] =>
  typeof value === 'object' && value !== null ? Object.values(value).flatMap(leaves) : [value];

/** A funder message and the one notification it queued. */
async function sentWithNotification(applicant?: Member) {
  const { id, email: address } = await t.submitted(applicant);
  await t.staffSent(id);
  const [notification] = await t.notifications([id]);
  if (notification === undefined) throw new Error('No notification was queued.');
  return { id, address, notification };
}

const emailsTo = (address: string) => t.sent.filter((email) => email.to === address);

describe('queueing the notification', () => {
  it('writes one queued row for the applicant and one job holding ids only, in the send’s transaction', async () => {
    const { id, notification } = await sentWithNotification();

    expect(notification).toMatchObject({
      status: 'queued',
      error_code: null,
      sent_at: null,
      recipient_person_id: (
        await t.rows<{ applicant_person_id: string }>(
          'SELECT applicant_person_id FROM grants.application WHERE id = $1',
          [id],
        )
      )[0]?.applicant_person_id,
    });
    const jobs = await t.waiting([id]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data['notificationId']).toBe(notification.id);
    expect(
      leaves(jobs[0]?.data).every(
        (leaf) => leaf === null || (typeof leaf === 'string' && UUID.test(leaf)),
      ),
    ).toBe(true);
    expect(JSON.stringify(jobs[0]?.data)).not.toMatch(/Synthetic|example\.org/);
    expect(await t.notifications([id])).toHaveLength(1);
  });

  it('queues nothing for an applicant’s message', async () => {
    const { id } = await t.submitted();
    await t.applicantSent(id, REPLY);

    expect(await t.notifications([id])).toEqual([]);
    expect(await t.waiting([id])).toEqual([]);
  });

  it('queues one for each funder message, none for a replay, and the row holds no address or text', async () => {
    const { id } = await t.submitted();
    const key = randomUUID();
    await t.sendStaff(id, MESSAGE, t.managerA, key);
    await t.sendStaff(id, MESSAGE, t.managerA, key);
    await t.staffSent(id, `${MESSAGE} again`);

    expect(await t.notifications([id])).toHaveLength(2);
    expect(await t.waiting([id])).toHaveLength(2);
    const columns = await t.rows<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'grants' AND table_name = 'message_notification'`,
    );
    expect(columns.map((column) => column.column_name)).not.toEqual(
      expect.arrayContaining(['email', 'address', 'body', 'subject']),
    );
  });

  it('leaves no message, row, job or event when the send is rolled back', async () => {
    const { id } = await t.submitted();
    const { routes } = composeModules({
      publicTenants: {
        tenant: () => Promise.resolve(undefined),
        logo: () => Promise.resolve(undefined),
      },
      jobs: t.jobs,
    });
    const send = routes.find(({ contract }) => contract === sendStaffMessage)?.handler;
    const context = {
      requestId: randomUUID(),
      session: { userId: t.managerA.userId },
      membership: { id: t.managerA.membershipId },
      audit: { record: () => Promise.resolve(), read: () => Promise.resolve() },
    };

    await expect(
      withTenant(api, trustedTenantId(t.tenantA.id), async (tx) => {
        await send?.({
          tx,
          context,
          input: { params: { submissionId: id }, body: { body: MESSAGE } },
        } as never);
        expect(
          await tx
            .selectFrom('grants.message_notification' as never)
            .selectAll()
            .execute(),
        ).not.toHaveLength(0);
        throw new Error('Roll back.');
      }),
    ).rejects.toThrow('Roll back.');

    expect(await t.notifications([id])).toEqual([]);
    expect(await t.waiting([id])).toEqual([]);
    expect(
      await t.rows('SELECT 1 FROM grants.application_message WHERE application_id = $1', [id]),
    ).toEqual([]);
  });
});

describe('the job', () => {
  it('sends one fixed email to the applicant, with none of the message in it, and marks the row sent', async () => {
    const { notification, address, id } = await sentWithNotification();

    await t.runNotification(t.tenantA.id, { notificationId: notification.id });

    const [email] = emailsTo(address);
    expect(emailsTo(address)).toHaveLength(1);
    expect(email?.subject).toBe('You have a new message about your application');
    expect(email?.text).toContain('Dear Ada,');
    expect(email?.text).toContain(`https://portal.example.org/applications/${id}/messages`);
    for (const part of [email?.subject, email?.text, email?.to, email?.requestId]) {
      expect(part).not.toMatch(/Synthetic|roof survey|Lovelace/);
    }
    expect(await t.notifications([id])).toMatchObject([{ status: 'sent', error_code: null }]);
    expect((await t.notifications([id]))[0]?.sent_at).toBeInstanceOf(Date);
  });

  it('sends nothing again for a row already sent', async () => {
    const { notification, address } = await sentWithNotification();

    await t.runNotification(t.tenantA.id, { notificationId: notification.id });
    await t.runNotification(t.tenantA.id, { notificationId: notification.id });

    expect(emailsTo(address)).toHaveLength(1);
  });

  it('finds nothing for another tenant’s row, an unknown id or a bad payload, and sends nothing', async () => {
    const { notification, address, id } = await sentWithNotification();

    await expect(
      t.runNotification(t.tenantB.id, { notificationId: notification.id }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      t.runNotification(t.tenantA.id, { notificationId: randomUUID() }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      t.runNotification(t.tenantA.id, { notificationId: 'not an id' }),
    ).rejects.toMatchObject({ code: 'invalid_payload' });

    expect(emailsTo(address)).toEqual([]);
    expect(await t.notifications([id])).toMatchObject([{ status: 'queued' }]);
  });

  it('skips while grants is switched off for the tenant, leaving the row queued', async () => {
    const { notification, address, id } = await sentWithNotification();
    await switchModule(t.tenantA, 'grants', false);
    try {
      await t.runNotification(t.tenantA.id, { notificationId: notification.id });
    } finally {
      await switchModule(t.tenantA, 'grants');
    }

    expect(emailsTo(address)).toEqual([]);
    expect(await t.notifications([id])).toMatchObject([{ status: 'queued' }]);
  });

  it('marks a refused email failed with a code only, and leaves the job complete', async () => {
    const { notification, id } = await sentWithNotification();
    t.sendWith(() => Promise.resolve({ sent: false, code: 'rejected' }));
    try {
      await t.runNotification(t.tenantA.id, { notificationId: notification.id });
    } finally {
      t.restore();
    }

    expect(await t.notifications([id])).toMatchObject([
      { status: 'failed', error_code: 'rejected' },
    ]);
  });

  it('retries when the mail server cannot be reached, and sends once it can', async () => {
    const { notification, address, id } = await sentWithNotification();
    t.sendWith(() => Promise.resolve({ sent: false, code: 'timeout' }));
    try {
      const failure = await t
        .runNotification(t.tenantA.id, { notificationId: notification.id })
        .catch((error: unknown) => error);
      expect(failure).toMatchObject({ code: 'internal' });
      expect((failure as Error).message).not.toMatch(/Synthetic|example\.org/);
    } finally {
      t.restore();
    }
    expect(await t.notifications([id])).toMatchObject([{ status: 'queued' }]);

    await t.runNotification(t.tenantA.id, { notificationId: notification.id });

    expect(emailsTo(address)).toHaveLength(1);
    expect(await t.notifications([id])).toMatchObject([{ status: 'sent' }]);
  });

  it('sends at least once: a crash after the mail server accepted it sends it again', async () => {
    const { notification, address, id } = await sentWithNotification();

    await expect(
      t.runNotification(t.tenantA.id, { notificationId: notification.id }, true),
    ).rejects.toThrow('The worker stopped');
    expect(emailsTo(address)).toHaveLength(1);
    expect(await t.notifications([id])).toMatchObject([{ status: 'queued' }]);

    await t.runNotification(t.tenantA.id, { notificationId: notification.id });

    expect(emailsTo(address)).toHaveLength(2);
    expect(await t.notifications([id])).toMatchObject([{ status: 'sent' }]);
  });
});

describe('the worker', () => {
  it('picks the job up, sends the email and keeps every message text out of its logs', async () => {
    // The worker also sends what earlier tests left queued, to their applicant: this one has its own.
    const { id, address } = await sentWithNotification(
      await addMember(t.tenantA, 'portal', 'applicant'),
    );
    expect(await t.waiting([id])).toHaveLength(1);

    const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
    const { host, port, database, password } = connectionSettings('app_queue');
    runner = await startWorker({
      queue: {
        host,
        port,
        database,
        password,
        applicationName: 'tps-api-tests',
        maxConnections: 2,
      },
      setup: { db: t.worker, sender: t.jobs, logger: jobLogger(logger) },
      handlers: handlerRegistry(jobLogger(logger), workerModuleJobs(t.mail)),
      schedules: [],
      onError: vi.fn(),
    });

    await vi.waitFor(
      async () => {
        expect(await t.notifications([id])).toMatchObject([{ status: 'sent' }]);
      },
      { timeout: 40_000, interval: 500 },
    );
    expect(emailsTo(address)).toHaveLength(1);
    expect(await t.waiting([id])).toEqual([]);
    // Other queues' leftover jobs may fail and be logged; this queue's never does.
    expect(
      logger.error.mock.calls.filter(([fields]) =>
        JSON.stringify(fields).includes('grants.message_notification'),
      ),
    ).toEqual([]);
    expect(
      JSON.stringify([logger.error.mock.calls, logger.warn.mock.calls, logger.info.mock.calls]),
    ).not.toMatch(/Synthetic|example\.org/);
  });
});
