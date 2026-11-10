// SPDX-License-Identifier: AGPL-3.0-or-later
//
// app.job_request (migration 0029, ADR 0009 "Jobs that act for a user"):
// isolation between tenants, the checks, the status moves and times the
// database owns, what app_api and app_worker may each change, and the
// requester-only output lookup and bounded delete.

import { randomUUID } from 'node:crypto';

import { jobRequestStatuses } from '@pixel-scientists/domain/platform/subject-access';
import type { Kysely } from 'kysely';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../../src/database.ts';
import {
  deleteExpiredJobRequests,
  findJobRequestOutput,
  JOB_REQUEST_KINDS,
} from '../../src/job-request.ts';
import { JOB_ERROR_CODES } from '../../src/jobs/handler.ts';
import { trustedTenantId, withTenant } from '../../src/tenant-context.ts';
import { databaseSettings, withClient } from '../connect.ts';
import { expectCrossTenantDenial } from '../cross-tenant.ts';
import {
  addMember,
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  insertStatement,
  outcome,
  type Row,
  type TestTenant,
} from '../tenants.ts';
import {
  addFile,
  expiredFailure,
  REQUESTS,
  requestRow,
  withRequestTriggerOff,
} from './fixtures.ts';

/** A tenant with two members and a file, and another tenant with its own. */
let tenant: TestTenant;
let other: TestTenant;
let member: string;
let second: string;
let file: string;
let stranger: string;
let strangersFile: string;
let worker: Kysely<unknown>;
beforeAll(async () => {
  [tenant, other] = [await createTestTenant(), await createTestTenant()];
  [member, second, file] = await asMigratorIn(tenant.id, async (client) => {
    const first = await addMember(client, tenant);
    return [first, await addMember(client, tenant), await addFile(client, tenant, first)];
  });
  [stranger, strangersFile] = await asMigratorIn(other.id, async (client) => {
    const own = await addMember(client, other);
    return [own, await addFile(client, other, own)];
  });
  worker = createDatabase<unknown>(databaseSettings('app_worker', 2));
}, 30_000);
afterAll(() => worker.destroy());

const request = (change: Row = {}) => requestRow(tenant, member, change);

/** Add a queued request as app_api on `client`, with the tenant set. */
const addRequest = (client: pg.ClientBase, change: Row = {}) =>
  insertRow(client, REQUESTS, request(change));

/** Each value in the CHECK on `column`, read from the catalogue. */
async function checkedValues(column: string): Promise<string[]> {
  return withClient('migrator', async (client) => {
    const { rows } = await client.query<{ definition: string }>(
      `SELECT pg_catalog.pg_get_constraintdef(c.oid) AS definition
         FROM pg_catalog.pg_constraint c
        WHERE c.conrelid = 'app.job_request'::regclass AND c.contype = 'c'
          AND c.conname = $1`,
      [`job_request_${column}_check`],
    );
    return [...(rows[0]?.definition ?? '').matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1] ?? '');
  });
}

describe('app.job_request', { timeout: 30_000 }, () => {
  it("keeps each tenant's requests from every other tenant, for app_api and app_worker", async () => {
    // Expired, so that app_worker, which deletes only expired requests, may
    // delete its own tenant's.
    await withRequestTriggerOff(() =>
      expectCrossTenantDenial('app.job_request', async (client, owner) => ({
        ...requestRow(owner, await addMember(client, owner)),
        ...expiredFailure(),
      })),
    );
  });

  it('lists the kinds, statuses and failure codes the code uses', async () => {
    expect(await checkedValues('kind')).toEqual([...JOB_REQUEST_KINDS]);
    expect(await checkedValues('status')).toEqual([...jobRequestStatuses]);
    expect(await checkedValues('failure_code')).toEqual([...JOB_ERROR_CODES]);
  });

  it.each([
    ['accepts a queued request', {}, 'ok'],
    ['accepts a form answer field', { field_ids: ['f_budget', 'app.file.name'] }, 'ok'],
    ['accepts dates and integers', { filters: '{"from": "2026-10-01", "limit": 50}' }, 'ok'],
    ['refuses an unknown kind', { kind: 'payroll' }, '23514'],
    ['refuses a permission of two parts', { permission: 'platform.export' }, '23514'],
    ['refuses a permission in capitals', { permission: 'Platform.audit.export' }, '23514'],
    ['refuses filters that are a list', { filters: '[]' }, '23514'],
    ['refuses a name in the filters', { filters: '{"name": "Ada Lovelace"}' }, '23514'],
    ['refuses an address in the filters', { filters: '{"to": ["ada@example.test"]}' }, '23514'],
    [
      'refuses a name as a key',
      { filters: '{"Ada Lovelace, 12 St James Square, London SW1": true}' },
      '23514',
    ],
    ['refuses a name as a key in a list', { filters: '{"ids": [{"Ada Lovelace": 1}]}' }, '23514'],
    [
      'accepts identifier keys at any depth',
      { filters: '{"partyId": "p1", "range": {"from": "2026-10-01"}}' },
      'ok',
    ],
    ['accepts empty filters', { filters: '{}' }, 'ok'],
    ['refuses a long token', { filters: JSON.stringify({ q: 'a'.repeat(65) }) }, '23514'],
    [
      'refuses filters over 8 KiB',
      { filters: JSON.stringify({ ids: Array.from({ length: 300 }, () => randomUUID()) }) },
      '23514',
    ],
    ['refuses no fields', { field_ids: [] }, '23514'],
    ['refuses a field id of two parts', { field_ids: ['app.file'] }, '23514'],
    ['refuses a field id with a space', { field_ids: ['app.file.name x'] }, '23514'],
    ['refuses a missing field id', { field_ids: ['app.file.name', null] }, '23514'],
    ['refuses a nested field list', { field_ids: [['app.file.name']] }, '23514'],
    ['refuses an unknown sensitivity', { output_sensitivity: 'secret' }, '23514'],
    ["refuses another tenant's member", { requested_by: 'stranger' }, '23503'],
  ])('%s', async (_, change: Row, expected) => {
    const values = change.requested_by === undefined ? change : { requested_by: stranger };
    await asRoleIn('migrator', tenant.id, async (client) => {
      const { text, values: params } = insertStatement(client, REQUESTS, request(values));
      expect(await outcome(client, text, params)).toBe(expected);
    });
  });

  it('queues every new request now, whatever the insert supplied', async () => {
    await asRoleIn('migrator', tenant.id, async (client) => {
      const id = await addRequest(client, {
        ...expiredFailure(),
        requested_at: new Date(0),
        updated_at: new Date(0),
      });
      const { rows } = await client.query(
        `SELECT status, failure_code, output_file_id, completed_at, expires_at,
                requested_at = now() AND updated_at = now() AS now
           FROM app.job_request WHERE id = $1`,
        [id],
      );
      expect(rows).toEqual([
        {
          status: 'queued',
          failure_code: null,
          output_file_id: null,
          completed_at: null,
          expires_at: null,
          now: true,
        },
      ]);
    });
  });

  it('lets app_api write a request but no outcome or time, and never change or remove one', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      for (const [column, value] of Object.entries({
        status: 'queued',
        failure_code: null,
        output_file_id: null,
        requested_at: new Date(),
        updated_at: new Date(),
        completed_at: null,
        expires_at: null,
      })) {
        const { text, values } = insertStatement(client, REQUESTS, request({ [column]: value }));
        expect(await outcome(client, text, values), column).toBe('42501');
      }
      const id = await addRequest(client);
      for (const set of [
        "status = 'running'",
        'filters = filters',
        'requested_by = requested_by',
      ]) {
        expect(await outcome(client, `UPDATE app.job_request SET ${set} WHERE id = $1`, [id])).toBe(
          '42501',
        );
      }
      expect(await outcome(client, 'DELETE FROM app.job_request WHERE id = $1', [id])).toBe(
        '42501',
      );
    });
  });

  it('lets app_worker move a request to ready with its file, and sets the times itself', async () => {
    const id = await asMigratorIn(tenant.id, (client) => addRequest(client));
    await asRoleIn('app_worker', tenant.id, async (client) => {
      const statement = (set: string) => `UPDATE app.job_request SET ${set} WHERE id = $1`;
      // outcome() undoes the update; move() keeps it.
      const update = (set: string, values: unknown[] = []) =>
        outcome(client, statement(set), [id, ...values]);
      const move = (set: string, values: unknown[] = []) =>
        client.query(statement(set), [id, ...values]);
      expect(await update("status = 'ready', output_file_id = $2", [file]), 'skips running').toBe(
        '55000',
      );
      await move("status = 'running'");
      expect(await update('status = status'), 'no change').toBe('ok');
      expect(await update("status = 'queued'"), 'back to queued').toBe('55000');
      expect(await update("status = 'ready'"), 'ready without a file').toBe('23514');
      expect(await update("status = 'failed'"), 'failed without a code').toBe('23514');
      expect(
        await update("status = 'ready', output_file_id = $2", [strangersFile]),
        "another tenant's file",
      ).toBe('23503');
      for (const column of ['filters', 'field_ids', 'permission', 'requested_by', 'kind']) {
        expect(await update(`${column} = ${column}`), column).toBe('42501');
      }

      await move("status = 'ready', output_file_id = $2, completed_at = $3", [file, new Date(0)]);
      const { rows } = await client.query(
        `SELECT status, completed_at = now() AS completed_now,
                expires_at = now() + interval '7 days' AS expires_in_7_days
           FROM app.job_request WHERE id = $1`,
        [id],
      );
      expect(rows).toEqual([{ status: 'ready', completed_now: true, expires_in_7_days: true }]);
      expect(
        await update("status = 'failed', failure_code = 'internal', output_file_id = NULL"),
        'ready to failed',
      ).toBe('55000');
      const deleted = await client.query('DELETE FROM app.job_request WHERE id = $1', [id]);
      expect(deleted.rowCount, 'an unexpired request is not deleted').toBe(0);

      await move("status = 'expired'");
      const expired = await client.query(
        'SELECT status, output_file_id FROM app.job_request WHERE id = $1',
        [id],
      );
      expect(expired.rows).toEqual([{ status: 'expired', output_file_id: null }]);
      expect(
        await update("status = 'ready', output_file_id = $2", [file]),
        'expired to ready',
      ).toBe('55000');
    });
  });

  it('refuses a change to what a request asks for, even from migrator', async () => {
    await asRoleIn('migrator', tenant.id, async (client) => {
      const id = await addRequest(client);
      for (const [column, value] of Object.entries({
        filters: '{}',
        field_ids: ['app.tenant.name'],
        permission: 'platform.audit.export',
        requested_by: second,
        output_sensitivity: 'public',
        request_id: randomUUID(),
      })) {
        expect(
          await outcome(
            client,
            `UPDATE app.job_request SET status = 'running', ${column} = $2 WHERE id = $1`,
            [id, value],
          ),
          column,
        ).toBe('23514');
      }
    });
  });

  it('fails a request with a code from the closed list only', async () => {
    const id = await asMigratorIn(tenant.id, (client) => addRequest(client));
    await asRoleIn('app_worker', tenant.id, async (client) => {
      await client.query("UPDATE app.job_request SET status = 'running' WHERE id = $1", [id]);
      const fail = (code: string) =>
        outcome(
          client,
          "UPDATE app.job_request SET status = 'failed', failure_code = $2 WHERE id = $1",
          [id, code],
        );
      expect(await fail('Could not read party Ada')).toBe('23514');
      expect(await fail('precondition_failed')).toBe('ok');
    });
  });

  it('gives the output only to its requester, only while ready and unexpired', async () => {
    const { ready, expired, running } = await withRequestTriggerOff(() =>
      asMigratorIn(tenant.id, async (client) => {
        const completed = new Date(Date.now() - 3_600_000);
        const times = {
          completed_at: completed,
          expires_at: new Date(completed.getTime() + 7 * 86_400_000),
        };
        const output = { status: 'ready', failure_code: null, output_file_id: file };
        return {
          ready: await addRequest(client, { ...output, ...times }),
          expired: await addRequest(client, { ...expiredFailure(), ...output }),
          running: await addRequest(client, { status: 'running' }),
        };
      }),
    );
    const api = createDatabase<unknown>(databaseSettings('app_api', 2));
    try {
      const find = (jobRequestId: string, membershipId: string, inTenant = tenant) =>
        withTenant(api, trustedTenantId(inTenant.id), (trx) =>
          findJobRequestOutput(trx, { jobRequestId, membershipId }),
        );
      expect(await find(ready, member)).toBe(file);
      expect(await find(ready, second), 'another member').toBeUndefined();
      expect(await find(ready, stranger, other), 'another tenant').toBeUndefined();
      expect(await find(expired, member), 'after expiry').toBeUndefined();
      expect(await find(running, member), 'not ready').toBeUndefined();
      expect(await find(randomUUID(), member), 'not there').toBeUndefined();
      expect(await find('not-an-id', member), 'not an id').toBeUndefined();
    } finally {
      await api.destroy();
    }
  });

  it("deletes only the tenant's expired requests, a bounded number at a time", async () => {
    const { expired, live, otherExpired } = await withRequestTriggerOff(async () => ({
      expired: await asMigratorIn(tenant.id, async (client) => [
        await addRequest(client, expiredFailure()),
        await addRequest(client, expiredFailure()),
      ]),
      live: await asMigratorIn(tenant.id, (client) => addRequest(client)),
      otherExpired: await asMigratorIn(other.id, (client) =>
        insertRow(client, REQUESTS, { ...requestRow(other, stranger), ...expiredFailure() }),
      ),
    }));
    const inTenant = trustedTenantId(tenant.id);
    await expect(
      withTenant(worker, inTenant, (trx) => deleteExpiredJobRequests(trx, 0)),
    ).rejects.toThrow('whole number');
    let deleted = 0;
    for (let round = 0; round < 1_000; round += 1) {
      const count = await withTenant(worker, inTenant, (trx) => deleteExpiredJobRequests(trx, 1));
      expect(count).toBeLessThanOrEqual(1);
      if (count === 0) break;
      deleted += count;
    }
    expect(deleted).toBeGreaterThanOrEqual(2);
    const left = async (owner: TestTenant) =>
      asMigratorIn(owner.id, async (client) => {
        const { rows } = await client.query<{ id: string }>(
          'SELECT id FROM app.job_request WHERE id = ANY($1)',
          [[...expired, live, otherExpired]],
        );
        return rows.map((row) => row.id);
      });
    expect(await left(tenant)).toEqual([live]);
    expect(await left(other)).toEqual([otherExpired]);
  });
});
