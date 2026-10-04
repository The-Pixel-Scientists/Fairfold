// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Starts the API: `node src/main.ts`, or `pnpm dev` with reload.
//
// The settings are checked first. If one is missing or not valid, the process
// prints which, to standard error, and exits with status 1 before it opens a
// port or a database connection.

import { buildApp } from './app.ts';
import { ConfigError, loadConfig, type Config } from './config.ts';
import { openDatabase } from './database.ts';
import { createLogger } from './logger.ts';
import { composeModules } from './modules.ts';

function readConfig(): Config | undefined {
  try {
    return loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      return undefined;
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const config = readConfig();
  if (config === undefined) {
    process.exitCode = 1;
    return;
  }

  const logger = createLogger({ level: config.logLevel });
  const database = openDatabase(config.database, logger);
  let app;
  try {
    app = await buildApp({
      logger,
      checkDatabase: () => database.check(),
      inTenant: database.inTenant,
      ...composeModules(),
      trustProxy: config.trustProxy,
    });
  } catch (error) {
    // A route that cannot be served safely stops the API here, naming the route.
    logger.fatal({ err: error }, 'The API could not be built');
    await database.close();
    process.exitCode = 1;
    return;
  }

  let stopping = false;
  const stop = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'Stopping');
    void app
      .close()
      .then(() => database.close())
      .then(
        () => {
          logger.info('Stopped');
        },
        (error: unknown) => {
          logger.error({ err: error }, 'The API did not stop cleanly');
          process.exitCode = 1;
        },
      );
  };
  process.once('SIGINT', () => {
    stop('SIGINT');
  });
  process.once('SIGTERM', () => {
    stop('SIGTERM');
  });
  // Log what ended the process, as a JSON line, rather than leave a stack trace
  // on standard error.
  process.once('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'An uncaught exception ended the process');
    process.exit(1);
  });
  process.once('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'An unhandled rejection ended the process');
    process.exit(1);
  });

  try {
    await app.listen({ host: config.listen.host, port: config.listen.port });
  } catch (error) {
    logger.fatal({ err: error }, 'The API could not start listening');
    await app.close();
    await database.close();
    process.exitCode = 1;
  }
}

await main();
