// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The privacy module's subject access and erasure contributions against the
// test database. Subject access lists a person's requests with their clock
// events and tasks, each cell with its sensitivity, and nothing of another
// person or tenant. Erasure runs as app_worker after the party is erased: it
// clears the summary and the task titles in place, keeps the record of the
// request, and a repeat changes nothing. Both run whether or not privacy is
// switched on for the tenant, since neither reads the module's switch. The
// subject access export runs as app_worker, so it is tested as app_worker. It
// stays out of the entry point, and its tests skip, until app_worker can read
// every column it lists; a test fails if the two fall out of step.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../../../../packages/db/src/database.ts';
import { trustedTenantId, withTenant } from '../../../../packages/db/src/tenant-context.ts';
import { databaseSettings } from '../../../../packages/db/test/connect.ts';
import { addErasureRequest } from '../../../../packages/db/test/erasure/fixtures.ts';
import { addPerson } from '../../../../packages/db/test/party/fixtures.ts';
import {
  eventRow,
  requestRow,
  SUMMARY,
  taskRow,
  TITLE,
} from '../../../../packages/db/test/privacy/fixtures.ts';
import {
  addMember,
  asMigratorIn,
  createTestTenant,
  insertRow,
  type TestTenant,
} from '../../../../packages/db/test/tenants.ts';
import { partyErasure, partyErasureTarget } from '@pixel-scientists/party/server';
import type { Tx } from './context.ts';
import { privacyErasure } from './erasure.ts';
import * as entry from './index.ts';
import { privacySubjectData, subjectTables } from './subject-data.ts';
import {
  as,
  closeDatabase,
  handlers,
  openDatabase,
  refusal,
  type Fixture,
} from './harness.integration.test.ts';

interface Tenant {
  readonly tenant: TestTenant;
  readonly member: string;
  readonly person: string;
  readonly bystander: string;
  readonly request: string;
  readonly task: string;
  readonly bystanderRequest: string;
}

let worker: ReturnType<typeof createDatabase<unknown>>;
let a: Tenant;
let b: Tenant;
let workerCanRead = false;

async function addTenant(): Promise<Tenant> {
  const tenant = await createTestTenant();
  return asMigratorIn(tenant.id, async (client) => {
    const member = await addMember(client, tenant);
    const person = await addPerson(client, tenant, { given_name: 'Ada' });
    const bystander = await addPerson(client, tenant, { given_name: 'Grace' });
    const request = await insertRow(
      client,
      'privacy.rights_request',
      requestRow(tenant, person, member),
    );
    await insertRow(client, 'privacy.request_clock_event', eventRow(tenant, request, member));
    const task = await insertRow(client, 'privacy.request_task', taskRow(tenant, request, member));
    const bystanderRequest = await insertRow(
      client,
      'privacy.rights_request',
      requestRow(tenant, bystander, member),
    );
    await addErasureRequest(client, tenant, member, person);
    return { tenant, member, person, bystander, request, task, bystanderRequest };
  });
}

const inWorker = <T>(tenant: Tenant, work: (tx: Tx) => Promise<T>) =>
  withTenant(worker, trustedTenantId(tenant.tenant.id), work);

const stored = (tenant: Tenant) =>
  asMigratorIn(tenant.tenant.id, async (client) => {
    const requests = await client.query<{ id: string; summary: string | null; kind: string }>(
      'SELECT id, summary, kind FROM privacy.rights_request ORDER BY id',
    );
    const tasks = await client.query<{ title: string }>('SELECT title FROM privacy.request_task');
    const events = await client.query('SELECT 1 FROM privacy.request_clock_event');
    return {
      requests: requests.rows,
      titles: tasks.rows.map((row) => row.title),
      events: events.rowCount,
    };
  });

beforeAll(async () => {
  openDatabase();
  const settings = databaseSettings('app_worker', 4);
  worker = createDatabase<unknown>({
    host: settings.host,
    port: settings.port,
    database: settings.database,
    password: settings.password,
    role: 'app_worker',
    maxConnections: 4,
    applicationName: 'tps-db-tests',
  });
  a = await addTenant();
  b = await addTenant();
  workerCanRead = await asMigratorIn(a.tenant.id, async (client) => {
    for (const [table, { columns }] of Object.entries(subjectTables)) {
      for (const [column] of columns) {
        const { rows } = await client.query<{ ok: boolean }>(
          "SELECT has_column_privilege('app_worker', $1, $2, 'SELECT') AS ok",
          [table, column],
        );
        if (rows[0]?.ok !== true) return false;
      }
    }
    return true;
  });
}, 60_000);

afterAll(async () => {
  await worker.destroy();
  await closeDatabase();
});

const asFixture = (tenant: Tenant): Fixture => ({
  tenant: tenant.tenant,
  member: tenant.member,
  second: tenant.member,
  person: tenant.person,
});

describe('privacySubjectData', () => {
  it('is in the entry point only once app_worker can read every column it lists', () => {
    expect('privacySubjectData' in entry).toBe(workerCanRead);
  });

  it('lists the person’s request, its clock events and its tasks with each cell’s sensitivity, and nobody else’s', async (context) => {
    if (!workerCanRead) context.skip();
    const result = await inWorker(a, (tx) => privacySubjectData.subjectData(tx, a.person));

    expect(Object.keys(result)).toEqual([
      'privacy.rights_request',
      'privacy.request_clock_event',
      'privacy.request_task',
    ]);
    expect(result['privacy.rights_request']).toHaveLength(1);
    expect(result['privacy.rights_request']?.[0]).toMatchObject({
      'privacy.rights_request.id': { value: a.request, sensitivity: 'internal' },
      'privacy.rights_request.summary': { value: SUMMARY, sensitivity: 'special_category' },
      'privacy.rights_request.received_on': { value: '2026-11-02', sensitivity: 'internal' },
    });
    expect(result['privacy.request_clock_event']?.[0]).toMatchObject({
      'privacy.request_clock_event.occurred_on': { value: '2026-11-03' },
    });
    expect(result['privacy.request_task']?.[0]).toMatchObject({
      'privacy.request_task.title': { value: TITLE, sensitivity: 'personal' },
    });
    expect(JSON.stringify(result)).not.toContain(a.bystanderRequest);
  });

  it('answers nothing for a person with no requests and for another tenant’s person', async (context) => {
    if (!workerCanRead) context.skip();
    const none = await inWorker(a, (tx) => privacySubjectData.subjectData(tx, a.bystander));
    const other = await inWorker(a, (tx) => privacySubjectData.subjectData(tx, b.person));

    expect(none['privacy.request_task']).toEqual([]);
    expect(none['privacy.rights_request']).toHaveLength(1);
    expect(other['privacy.rights_request']).toEqual([]);
    expect(other['privacy.request_task']).toEqual([]);
  });
});

describe('privacyErasure', () => {
  it('refuses until the party is erased, and changes nothing', async () => {
    const subject = {
      partyId: a.bystander,
      givenName: null,
      familyName: null,
      email: null,
      accountId: null,
    };

    await expect(inWorker(a, (tx) => privacyErasure.erase(tx, [subject]))).rejects.toThrow(
      /only once the party is erased/,
    );
    expect((await stored(a)).requests.every((row) => row.summary !== null)).toBe(true);
  });

  it('does nothing in tenant B for tenant A’s person', async () => {
    const subject = {
      partyId: a.person,
      givenName: null,
      familyName: null,
      email: null,
      accountId: null,
    };

    await expect(inWorker(b, (tx) => privacyErasure.erase(tx, [subject]))).rejects.toThrow();
    expect((await stored(a)).requests.every((row) => row.summary !== null)).toBe(true);
  });

  it('clears the summary and task titles after the party is erased, keeps the record, and a repeat clears nothing', async () => {
    const counts = await inWorker(a, async (tx) => {
      const target = await partyErasureTarget(tx, a.person);
      const subjects = target?.subjects ?? [];
      await partyErasure.erase(tx, subjects);
      return privacyErasure.erase(tx, subjects);
    });

    expect(counts).toEqual({ 'privacy.rights_request': 1, 'privacy.request_task': 1 });
    const after = await stored(a);
    expect(after.requests.find((row) => row.id === a.request)).toMatchObject({
      summary: null,
      kind: 'access',
    });
    expect(after.requests.find((row) => row.id === a.bystanderRequest)?.summary).toBe(SUMMARY);
    expect(after.titles).toEqual(['erased']);
    expect(after.events).toBe(1);
    expect(await stored(b)).toMatchObject({ titles: [TITLE] });

    const target = await inWorker(a, (tx) => partyErasureTarget(tx, a.person));
    const again = await inWorker(a, (tx) => privacyErasure.erase(tx, target?.subjects ?? []));
    expect(again).toEqual({ 'privacy.rights_request': 0, 'privacy.request_task': 0 });
  });

  it('leaves an erased person’s request unchangeable by text, with a plain refusal', async () => {
    const refused = await refusal(
      as(asFixture(a), a.member, (tx, context) =>
        handlers.updateRightsRequest({
          tx,
          context,
          input: {
            params: { requestId: a.request },
            body: {
              kind: 'access',
              channel: 'email',
              summary: 'Synthetic new text',
              identityCheck: 'verified',
            },
          },
        }),
      ),
    );

    expect(refused).toMatchObject({
      status: 409,
      message: "This person's data has been erased, so the text cannot change.",
    });
  });
});
