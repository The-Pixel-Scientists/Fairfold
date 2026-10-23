// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Starts the API: `node src/main.ts`, or `pnpm dev` with reload.
//
// The settings are checked first. If one is missing or not valid, the process
// prints which, to standard error, and exits with status 1 before it opens a
// port or a database connection.

import { buildApp } from './app.ts';
import { loadAuthSettings, createAuth, type AuthSettings } from './auth/index.ts';
import { ConfigError, loadConfig, type Config } from './config.ts';
import { openDatabase } from './database.ts';
import { createFileService, loadFileSettings, type FileSettings } from './platform/files/index.ts';
import { createSender } from './email/sender.ts';
import { createSmtpTransport } from './email/transport.ts';
import { createLogger } from './logger.ts';
import { composeModules } from './modules.ts';

/** Both groups of settings, with every problem in either reported together. */
function readSettings():
  { config: Config; authSettings: AuthSettings; fileSettings: FileSettings } | undefined {
  const problems: string[] = [];
  const read = <T>(load: () => T): T | undefined => {
    try {
      return load();
    } catch (error) {
      if (error instanceof ConfigError) {
        problems.push(...error.problems);
        return undefined;
      }
      throw error;
    }
  };
  const config = read(() => loadConfig(process.env));
  const authSettings = read(() => loadAuthSettings(process.env));
  const fileSettings = read(() => loadFileSettings(process.env));
  if (config === undefined || authSettings === undefined || fileSettings === undefined) {
    process.stderr.write(`${new ConfigError(problems).message}\n`);
    return undefined;
  }
  return { config, authSettings, fileSettings };
}

async function main(): Promise<void> {
  const settings = readSettings();
  if (settings === undefined) {
    process.exitCode = 1;
    return;
  }
  const { config, authSettings, fileSettings } = settings;

  const logger = createLogger({ level: config.logLevel });
  const database = openDatabase(config.database, logger);
  // The auth and module emails go through the configured mail server (S02-16b).
  const sender = createSender(config.smtp, logger, createSmtpTransport(config.smtp));
  // Better Auth refuses to start beside its own environment variables.
  let auth;
  try {
    auth = createAuth(authSettings, { database: config.database, log: logger, sender });
  } catch (error) {
    if (error instanceof ConfigError) process.stderr.write(`${error.message}\n`);
    else logger.fatal({ err: error }, 'The auth module could not be created');
    await database.close();
    process.exitCode = 1;
    return;
  }
  // Closed in order: the pools of the auth module, then the API's.
  const closeAll = async (): Promise<void> => {
    await auth.close();
    await database.close();
  };
  let app;
  try {
    app = await buildApp({
      logger,
      checkDatabase: () => database.check(),
      inTenant: database.inTenant,
      files: createFileService(fileSettings),
      auth,
      ...composeModules({
        publicTenants: database.publicTenants,
        mail: { sender, portalOrigin: authSettings.origins.portal },
      }),
      trustProxy: config.trustProxy,
    });
  } catch (error) {
    // A route that cannot be served safely stops the API here, naming the route.
    logger.fatal({ err: error }, 'The API could not be built');
    await closeAll();
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
      .then(closeAll)
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
    await closeAll();
    process.exitCode = 1;
  }
}

await main();
