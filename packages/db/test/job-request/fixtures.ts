// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Fixtures for the job request tests (migration 0029). The database sets a
// request's status and times, so a finished or expired request can only be
// added by migrator with the trigger off.

import { randomUUID } from 'node:crypto';

import type pg from 'pg';

import { withClient } from '../connect.ts';
import { insertRow, type Row, type TestTenant } from '../tenants.ts';

export const REQUESTS = 'app.job_request';

/** A queued subject access request by `member` of `tenant`. */
export function requestRow(tenant: TestTenant, member: string, change: Row = {}): Row {
  return {
    tenant_id: tenant.id,
    kind: 'subject_access',
    requested_by: member,
    permission: 'platform.subject_access.request',
    filters: JSON.stringify({ partyId: randomUUID() }),
    field_ids: ['party.person.given_name', 'party.person.email'],
    output_sensitivity: 'personal',
    request_id: randomUUID(),
    ...change,
  };
}

/** The outcome and times of a request that failed 8 days ago, and expired yesterday. */
export function expiredFailure(): Row {
  const completed = new Date(Date.now() - 8 * 86_400_000);
  return {
    status: 'failed',
    failure_code: 'internal',
    completed_at: completed,
    expires_at: new Date(completed.getTime() + 7 * 86_400_000),
  };
}

/** A file uploaded by `member` in the tenant set on `client`, as migrator. */
export function addFile(client: pg.ClientBase, tenant: TestTenant, member: string) {
  return insertRow(client, 'app.file', {
    tenant_id: tenant.id,
    name: 'export.pdf',
    content_type: 'application/pdf',
    size_bytes: 100,
    created_by: member,
  });
}

/** Run `work` with the request trigger off, and turn it on again whatever happens. */
export async function withRequestTriggerOff<T>(work: () => Promise<T>): Promise<T> {
  const set = (state: 'DISABLE' | 'ENABLE') =>
    withClient('migrator', (client) =>
      client.query(`ALTER TABLE app.job_request ${state} TRIGGER keep_job_request`),
    );
  await set('DISABLE');
  try {
    return await work();
  } finally {
    await set('ENABLE');
  }
}
