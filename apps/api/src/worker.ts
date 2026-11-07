// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Starts the worker: `node src/worker.ts`, from the API's image (ADR 0009).
// It runs the job handlers as app_worker and pg-boss as app_queue, opens no
// port, and checks its settings, as main.ts does, before any connection.

// Installs the outbound rules (ADR 0010). Keep it first: it must run before any
// other module loads and can make a request.
import './outbound/install.ts';

import { createDatabase } from '@pixel-scientists/db';
import { startJobSender, startWorker, stopJobSender, stopWorker } from '@pixel-scientists/db/jobs';

import { ConfigError } from './config.ts';
import { createLogger } from './logger.ts';
import { pinnedFetch } from './outbound/pinned.ts';
import { proxyProblems } from './outbound/proxy.ts';
import { createFilesJob } from './platform/files/index.ts';
import { startTelemetry } from './telemetry/index.ts';
import { jobLogger } from './worker/job-logger.ts';
import { handlerRegistry, type ModuleJob } from './worker/registry.ts';
import { schedules } from './worker/schedules.ts';
import { loadWorkerSettings, type WorkerSettings } from './worker/settings.ts';
import { shutDown } from './worker/shutdown.ts';

/** Module handlers, filled from each module's `jobs` export by the module composition (S11-69). */
const moduleJobs: readonly ModuleJob[] = [];

function readSettings(): WorkerSettings | undefined {
  try {
    const problems = proxyProblems(process.env);
    if (problems.length > 0) throw new ConfigError(problems);
    return loadWorkerSettings(process.env);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    const lines = error.problems.map((problem) => `  - ${problem}`);
    process.stderr.write(
      `The worker cannot start because its settings are not valid:\n${lines.join('\n')}\n`,
    );
    return undefined;
  }
}

async function main(): Promise<void> {
  const settings = readSettings();
  if (settings === undefined) {
    process.exitCode = 1;
    return;
  }
  const telemetry = startTelemetry({ service: 'worker', settings: settings.telemetry });
  const logger = createLogger({ level: settings.logLevel });
  const onError = (error: Error) => {
    logger.error({ err: error }, 'The job queue reported a problem');
  };
  const { database } = settings;
  const connection = { host: database.host, port: database.port, database: database.database };
  const tls = database.tls === undefined ? {} : { tls: database.tls };
  const db = createDatabase<unknown>({
    host: database.host,
    port: database.port,
    database: database.database,
    tls: database.tls,
    role: 'app_worker',
    password: settings.workerPassword.reveal(),
    applicationName: 'tps-worker',
    log: (message, error) => {
      logger.error({ err: error }, message);
    },
  });
  let sender;
  let runner;
  try {
    sender = await startJobSender(db, onError);
    runner = await startWorker({
      queue: {
        ...connection,
        ...tls,
        password: settings.queuePassword.reveal(),
        applicationName: 'tps-worker-queue',
        maxConnections: 4,
      },
      setup: { db, sender, logger: jobLogger(logger) },
      handlers: handlerRegistry(
        jobLogger(logger),
        moduleJobs,
        createFilesJob(settings.files, pinnedFetch(settings.files.storage.endpoint)),
      ),
      schedules,
      onError,
    });
  } catch (error) {
    logger.fatal({ err: error }, 'The worker could not start');
    if (sender !== undefined) await stopJobSender(sender);
    await telemetry.shutdown();
    await db.destroy();
    process.exitCode = 1;
    return;
  }
  const started = { runner, sender };

  let stopping = false;
  const stop = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'Stopping');
    void shutDown({
      stopJobs: (limit) => stopWorker(started.runner, limit),
      telemetry: () => telemetry.shutdown(),
      sender: () => stopJobSender(started.sender),
      database: () => db.destroy(),
    }).then((failed) => {
      if (failed > 0) process.exitCode = 1;
      logger.info('Stopped');
    });
  };
  process.once('SIGINT', () => {
    stop('SIGINT');
  });
  process.once('SIGTERM', () => {
    stop('SIGTERM');
  });
  process.once('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'An uncaught exception ended the process');
    process.exit(1);
  });
  process.once('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'An unhandled rejection ended the process');
    process.exit(1);
  });
  logger.info('The worker is running');
}

await main();
