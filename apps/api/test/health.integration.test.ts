// SPDX-License-Identifier: AGPL-3.0-or-later
//
// GET /health/ready against the real test database, as app_api. The db
// project supplies the settings (scripts/dev-env.ts, profile database-tests).

import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { openDatabase, type ApiDatabase } from '../src/database.ts';
import { createLogger } from '../src/logger.ts';
import { captureLogs, smtpTestSettings } from './support.ts';

const WRONG_PASSWORD = 'a-wrong-password-for-the-test';

let app: FastifyInstance | undefined;
let database: ApiDatabase | undefined;

afterEach(async () => {
  await app?.close();
  await database?.close();
  app = undefined;
  database = undefined;
});

/** The API, set up the way main.ts does it, against the test database. */
async function startApi(password = process.env['TPS_DB_APP_API_PASSWORD']) {
  const { database: settings } = loadConfig({
    ...process.env,
    ...smtpTestSettings,
    // Not read here: the API listens on no port in this test.
    TPS_API_PORT: '41000',
    TPS_DB_NAME: process.env['TPS_TEST_DB_NAME'],
    TPS_DB_APP_API_PASSWORD: password,
  });
  const logs = captureLogs();
  const logger = createLogger({ level: 'info', destination: logs.stream });
  const opened = openDatabase(settings, logger);
  database = opened;
  app = await buildApp({
    logger,
    checkDatabase: () => opened.check(),
    readinessTimeoutMs: 5000,
  });
  return { app, logs };
}

describe('GET /health/ready with the test database', () => {
  it('answers 200 when app_api can connect and query', async () => {
    const { app: server } = await startApi();

    const response = await server.inject({ url: '/health/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', checks: { database: 'ok' } });
  });

  it('answers 503 with a wrong password, and keeps the password and the reason out of both the response and the log', async () => {
    const { app: server, logs } = await startApi(WRONG_PASSWORD);

    const response = await server.inject({ url: '/health/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'unavailable', checks: { database: 'unavailable' } });
    expect(response.body).not.toContain('password');
    expect(logs.text()).not.toContain(WRONG_PASSWORD);
    // PostgreSQL's SQLSTATE for a failed password check.
    expect(logs.lines().find((line) => line.msg === 'The database is not ready')).toMatchObject({
      level: 'warn',
      err: { code: '28P01' },
    });
  });
});
