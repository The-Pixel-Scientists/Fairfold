// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The platform's queues (migrations 0029, 0043, 0053, 0061 and 0063): each is registered
// with its kind and a dead-letter queue <queue>.dead of the same kind, each can be
// defined in code under its registered name, and no other queue is
// registered but pg-boss's cron queue (migration 0036) and the job tests'
// own.

import { describe, expect, it } from 'vitest';

import { createDatabase } from '../../src/database.ts';
import { jobRequestPayload } from '../../src/job-request.ts';
import { defineQueue, eventJobQueue } from '../../src/jobs/queue.ts';
import { queueRegistrationProblems } from '../../src/jobs/registration.ts';
import { databaseSettings, withClient } from '../connect.ts';

const PLATFORM = [
  'platform.fan_out',
  'platform.audit_purge',
  'platform.file_fan_out',
  'assure.sanctions_list_refresh',
];
const TENANT = [
  'platform.file_scan',
  'platform.idempotency_purge',
  'platform.subject_access_export',
  'platform.erasure',
  'platform.job_request_expiry',
  'platform.retention_sweep',
  'platform.view_csv_export',
  'platform.audit_log_export',
  'platform.board_pack',
  'grants.release_email',
  'grants.message_notification',
  'grants.reminder_scan',
  'grants.reminder_send',
  'assure.registry_refresh',
  'assure.screening',
  'crm.import_parse',
];
const EVENTS = ['crm', 'assure'] as const;

/** Each source queue's name, kind and dead-letter queue. */
const EXPECTED = [
  { name: '__pgboss__send-it', kind: 'platform', dead_letter: null },
  ...[
    ...PLATFORM.map((name) => [name, 'platform'] as const),
    ...[...TENANT, ...EVENTS.map((module) => `events.${module}`)].map(
      (name) => [name, 'tenant'] as const,
    ),
  ].flatMap(([name, kind]) => [
    { name, kind, dead_letter: `${name}.dead` },
    { name: `${name}.dead`, kind, dead_letter: null },
  ]),
];

/**
 * Queues the job tests register while they run: S11-48's test queues, and
 * events.insight, which publish.test.ts adds until the insight schema
 * migration registers it.
 */
const isTestQueue = (name: string) => name.startsWith('test_jobs_') || name === 'events.insight';

describe('the registered queues', () => {
  it('are the platform queues, each with its dead-letter queue of the same kind', () =>
    withClient('migrator', async (client) => {
      const { rows } = await client.query<{ name: string; kind: string; dead_letter: string }>(
        `SELECT r.name, r.kind, q.dead_letter
           FROM app.job_queue r JOIN pgboss.queue q ON q.name = r.name
          ORDER BY r.name`,
      );
      const registered = rows.filter(({ name }) => !isTestQueue(name));
      const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
      expect(registered.sort(byName)).toEqual([...EXPECTED].sort(byName));
    }));

  it('can each be defined in code under its registered name and kind', async () => {
    for (const name of PLATFORM) defineQueue(name, 'platform', jobRequestPayload);
    for (const name of TENANT) defineQueue(name, 'tenant', jobRequestPayload);
    for (const module of EVENTS) eventJobQueue(module);
    const api = createDatabase<unknown>(databaseSettings('app_api', 1));
    try {
      expect(await queueRegistrationProblems(api)).toEqual([]);
    } finally {
      await api.destroy();
    }
  });
});
