// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The counter store and the limits against the real app.request_limit, as
// app_api, with two API instances on one database.

import { randomInt } from 'node:crypto';

import { createDatabase } from '@pixel-scientists/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withClient } from '../../../../packages/db/test/connect.ts';
import { smtpTestSettings } from '../../test/support.ts';
import { buildApp } from '../app.ts';
import { loadConfig, Secret } from '../config.ts';
import { openDatabase, type ApiDatabase } from '../database.ts';
import { createLogger } from '../logger.ts';
import { clientNetwork, keyHash } from './client-key.ts';
import { LIMITS } from './definitions.ts';
import { counterStore } from './store.ts';

const KEY = new Secret('an-integration-key-of-32-bytes-or-more');

let settings: ReturnType<typeof loadConfig>['database'];
const databases: ApiDatabase[] = [];
const apps: FastifyInstance[] = [];
/** Every statement the recording store sent, as the connection saw it. */
const statements: string[] = [];

async function instance(): Promise<FastifyInstance & { database: ApiDatabase }> {
  const database = openDatabase(settings, createLogger({ level: 'silent' }));
  const app = await buildApp({
    logger: createLogger({ level: 'silent' }),
    checkDatabase: () => database.check(),
    limits: { store: database.requestLimits, key: KEY },
  });
  apps.push(app);
  databases.push(database);
  return Object.assign(app, { database });
}

/** An address in the documentation range, new each run so that windows left by earlier runs never count. */
const newAddress = () =>
  `2001:db8:${randomInt(65536).toString(16)}:${randomInt(65536).toString(16)}::1`;

beforeAll(() => {
  settings = loadConfig({
    ...process.env,
    ...smtpTestSettings,
    TPS_API_PORT: '41005',
    TPS_DB_NAME: process.env['TPS_TEST_DB_NAME'],
  }).database;
});

afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
  await Promise.all(databases.map((database) => database.close()));
});

describe('the counters in app.request_limit', { timeout: 30_000 }, () => {
  it('are shared by two API instances', async () => {
    const [first, second] = [await instance(), await instance()];
    const remoteAddress = newAddress();

    for (let i = 0; i < LIMITS.openapi.max; i++) {
      const response = await (i % 2 === 0 ? first : second).inject({
        url: '/openapi.json',
        remoteAddress,
      });
      expect(response.statusCode).toBe(200);
    }
    const refused = await first.inject({ url: '/openapi.json', remoteAddress });

    expect(refused.statusCode).toBe(429);
    expect(refused.headers['retry-after']).toMatch(/^[1-9]\d?$/);
    expect(refused.json()).not.toHaveProperty('errors');
    expect(
      (await second.inject({ url: '/openapi.json', remoteAddress: newAddress() })).statusCode,
    ).toBe(200);
  });

  it('hold only the 32-byte hash of the client key, with the count and the window', async () => {
    const app = await instance();
    const remoteAddress = newAddress();

    await app.inject({ url: '/health', remoteAddress });
    await app.inject({ url: '/health', remoteAddress });

    const expected = keyHash(KEY, 'probe', clientNetwork(remoteAddress));
    const { rows } = await withClient('app_api', (client) =>
      client.query<{ bucket: string; count: number; bytes: number; whole_window: boolean }>(
        `SELECT bucket, count::int AS count, octet_length(key_hash) AS bytes,
                extract(epoch FROM window_start)::bigint % 60 = 0 AS whole_window
           FROM app.request_limit WHERE key_hash = $1`,
        [expected],
      ),
    );
    expect(rows).toEqual([{ bucket: 'probe', count: 2, bytes: 32, whole_window: true }]);
    const clear = await withClient('app_api', (client) =>
      client.query(
        `SELECT 1 FROM app.request_limit
          WHERE octet_length(key_hash) <> 32 OR position(convert_to($1, 'utf8') IN key_hash) > 0`,
        [remoteAddress],
      ),
    );
    expect(clear.rowCount).toBe(0);
  });

  it('are written with one upsert and no tenant on the connection', async () => {
    const recording = createDatabase<unknown>({
      host: settings.host,
      port: settings.port,
      database: settings.database,
      role: 'app_api',
      password: settings.password.reveal(),
      applicationName: 'tps-limits-test',
      tls: settings.tls,
    }).withPlugin({
      transformQuery: ({ node }) => {
        statements.push(JSON.stringify(node));
        return node;
      },
      transformResult: ({ result }) => Promise.resolve(result),
    });
    try {
      const store = counterStore(recording);
      const key = keyHash(KEY, 'general_ip', newAddress());

      expect((await store.count('general', key, 60)).count).toBe(1);
      expect((await store.count('general', key, 60)).count).toBe(2);
    } finally {
      await recording.destroy();
    }

    expect(statements).toHaveLength(2);
    for (const statement of statements) {
      expect(statement).toContain('"kind":"InsertQueryNode"');
      expect(statement).toContain('"kind":"OnConflictNode"');
      expect(statement.toLowerCase()).not.toContain('tenant');
    }
  });

  it('use a pool of their own, apart from the one tenant transactions use', async () => {
    const app = await instance();

    await app.inject({ url: '/health', remoteAddress: newAddress() });
    await app.database.check();

    const { rows } = await withClient('app_api', (client) =>
      client.query<{ application_name: string }>(
        `SELECT DISTINCT application_name FROM pg_stat_activity
          WHERE application_name IN ('tps-api', 'tps-api-limits')`,
      ),
    );
    expect(rows.map((row) => row.application_name).sort()).toEqual(['tps-api', 'tps-api-limits']);
  });

  it('are not starved by one address holding 200 requests open at once', async () => {
    const database = openDatabase(settings, createLogger({ level: 'silent' }));
    databases.push(database);
    let calls = 0;
    const app = await buildApp({
      logger: createLogger({ level: 'silent' }),
      checkDatabase: () => database.check(),
      limits: {
        store: {
          count: (...args) => {
            calls++;
            return database.requestLimits.count(...args);
          },
        },
        key: KEY,
      },
    });
    apps.push(app);
    const flooder = newAddress();
    const codes: number[] = [];

    for (let round = 0; round < 20; round++) {
      const batch = Array.from({ length: 200 }, () =>
        app.inject({ url: '/api/no-such-route', remoteAddress: flooder }),
      );
      const other = app.inject({ url: '/api/no-such-route', remoteAddress: newAddress() });
      expect((await other).statusCode).toBe(404);
      codes.push(...(await Promise.all(batch)).map((response) => response.statusCode));
    }

    expect(codes).not.toContain(503);
    expect(codes.filter((code) => code === 404)).toHaveLength(LIMITS.general_ip.max);
    expect(codes.filter((code) => code === 429)).toHaveLength(4000 - LIMITS.general_ip.max);
    expect(calls).toBeLessThanOrEqual(LIMITS.general_ip.max + 20);
  });

  it('answer 503 on a general route, and 200 on /health, while the database is down', async () => {
    const app = await instance();
    databases.pop();
    await app.database.close();

    expect((await app.inject({ url: '/api/no-such-route' })).statusCode).toBe(503);
    expect((await app.inject({ url: '/health' })).statusCode).toBe(200);
  });
});
