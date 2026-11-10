// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The worker sends the release emails (ADR 0009, ADR 0020): a release queues
// one job per email as app_api, and a running worker, as app_queue and
// app_worker with the privileges the migrations give them, picks the job up
// and sends the mail.

import { randomUUID } from 'node:crypto';

import { startWorker, stopWorker, type WorkerRunner } from '@pixel-scientists/db/jobs';
import type { ReleaseResult } from '@pixel-scientists/grants/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { connectionSettings } from '../../../packages/db/test/connect.ts';
import { jobLogger } from '../src/worker/job-logger.ts';
import { workerModuleJobs } from '../src/worker/module-jobs.ts';
import { handlerRegistry } from '../src/worker/registry.ts';
import { accepted, startDecisionsApi, type DecisionsApi } from './decisions-api.ts';
import { answer } from './programme-api.ts';

vi.setConfig({ testTimeout: 60_000 });

let t: DecisionsApi;
let runner: WorkerRunner | undefined;

beforeAll(async () => {
  t = await startDecisionsApi('41053');
  // Earlier test files leave jobs behind; the worker would work through them first.
  await t.rows("DELETE FROM pgboss.job WHERE name = 'grants.release_email'");
}, 60_000);

afterAll(async () => {
  if (runner !== undefined) await stopWorker(runner, 5_000);
  await t.close();
});

describe('the worker', () => {
  it('picks up a queued release email and sends it, then records it as sent', async () => {
    const round = await t.reviewRound();
    const submission = await t.submission(round);
    const email = `ada-${randomUUID()}@example.org`;
    await t.personOf(t.ann, 'Ada', email);
    await t.recorded(submission, accepted(15_000));
    await answer<ReleaseResult>(t.release(round.open.round.id));
    expect(await t.queued([submission])).toHaveLength(1);
    expect(t.sent).toEqual([]);

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
        expect((await t.emails([submission]))[0]).toMatchObject({ status: 'sent' });
      },
      { timeout: 40_000, interval: 500 },
    );
    expect(t.sent.map((message) => message.to)).toEqual([email]);
    expect(t.sent[0]?.text).toContain('Dear Ada,');
    expect(await t.queued([submission])).toEqual([]);
    const [event] = await t.rows<{ actor_kind: string; job_id: string | null }>(
      `SELECT e.actor_kind, e.job_id FROM app.audit_event e
        WHERE e.action = 'grants.decision_email.sent' AND e.job_id IS NOT NULL
          AND e.entity_id IN (SELECT x.id FROM grants.decision_email x
                                JOIN grants.decision d ON d.id = x.decision_id
                               WHERE d.application_id = $1)`,
      [submission],
    );
    expect(event).toMatchObject({ actor_kind: 'system' });
    expect(logger.error).not.toHaveBeenCalled();
  });
});
