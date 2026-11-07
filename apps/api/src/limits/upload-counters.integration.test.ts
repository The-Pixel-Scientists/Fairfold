// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The upload counters in the real app.request_limit, as app_api (ADR 0030):
// an add that would pass the maximum changes nothing, the bucket check and
// bigint count accept the four upload buckets, and parallel adds never pass
// the maximum together.

import { randomBytes } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withClient } from '../../../../packages/db/test/connect.ts';
import { smtpTestSettings } from '../../test/support.ts';
import { loadConfig } from '../config.ts';
import { openDatabase, type ApiDatabase } from '../database.ts';
import { createLogger } from '../logger.ts';

const HOUR = 3600;
let database: ApiDatabase;

beforeAll(() => {
  const { database: settings } = loadConfig({
    ...process.env,
    ...smtpTestSettings,
    TPS_API_PORT: '41006',
    TPS_DB_NAME: process.env['TPS_TEST_DB_NAME'],
  });
  database = openDatabase(settings, createLogger({ level: 'silent' }));
});

afterAll(async () => {
  await database.close();
});

const newKey = () => randomBytes(32);

describe('the upload counters', { timeout: 30_000 }, () => {
  it('add up to the maximum, then refuse without changing the count', async () => {
    const { requestLimits: store } = database;
    const key = newKey();
    expect(await store.add('upload_bytes_membership', key, HOUR, 600, 1000)).toEqual({
      charged: true,
    });
    expect(await store.add('upload_bytes_membership', key, HOUR, 400, 1000)).toEqual({
      charged: true,
    });
    const refused = await store.add('upload_bytes_membership', key, HOUR, 1, 1000);
    expect(refused.charged).toBe(false);
    if (!refused.charged) expect(refused.retryAfter).toBeGreaterThanOrEqual(1);

    const rows = await withClient('app_api', (client) =>
      client.query<{ count: string }>(
        "SELECT count FROM app.request_limit WHERE bucket = 'upload_bytes_membership' AND key_hash = $1",
        [key],
      ),
    );
    expect(rows.rows.map((row) => row.count)).toEqual(['1000']);
  });

  it('refuse a first charge over the maximum, leaving no row', async () => {
    const { requestLimits: store } = database;
    const key = newKey();
    const refused = await store.add('upload_bytes_address', key, HOUR, 1001, 1000);
    expect(refused.charged).toBe(false);
    const rows = await withClient('app_api', (client) =>
      client.query('SELECT 1 FROM app.request_limit WHERE key_hash = $1', [key]),
    );
    expect(rows.rowCount).toBe(0);
  });

  it('take a charge back, never below zero, and allow the room to be used again', async () => {
    const { requestLimits: store } = database;
    const key = newKey();
    await store.add('upload_files_address', key, HOUR, 1, 1);
    expect((await store.add('upload_files_address', key, HOUR, 1, 1)).charged).toBe(false);
    await store.subtract('upload_files_address', key, HOUR, 1);
    await store.subtract('upload_files_address', key, HOUR, 5);
    expect((await store.add('upload_files_address', key, HOUR, 1, 1)).charged).toBe(true);
  });

  it('keep the buckets and keys apart, and hold the maximum under parallel adds', async () => {
    const { requestLimits: store } = database;
    const key = newKey();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => store.add('upload_files_membership', key, HOUR, 1, 10)),
    );
    expect(results.filter((result) => result.charged)).toHaveLength(10);
    expect((await store.add('upload_files_address', key, HOUR, 1, 10)).charged).toBe(true);
    expect((await store.add('upload_files_membership', newKey(), HOUR, 1, 10)).charged).toBe(true);
  });

  it('still count the public buckets by one', async () => {
    const counted = await database.requestLimits.count('general', newKey(), 60);
    expect(counted.count).toBe(1);
  });
});
