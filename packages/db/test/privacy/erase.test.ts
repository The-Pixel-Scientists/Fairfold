// SPDX-License-Identifier: AGPL-3.0-or-later
//
// privacy.erase_subject (migration 0092, ADR 0027): only app_worker runs
// it, only for a party already erased in the transaction's tenant. Erasing
// a person anonymises them in place, so their rights requests survive with
// their kind, dates and clock; the function clears each request's summary
// and its tasks' titles, deletes nothing, and after a restore clears the
// restored rows again. Once the person is erased, app_api may clear a
// summary but write no new text or request about them.

import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import { addErasureRequest, callAs, erase } from '../erasure/fixtures.ts';
import { addPerson } from '../party/fixtures.ts';
import {
  addMember,
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  outcome,
  type Row,
  type TestTenant,
} from '../tenants.ts';
import { eventRow, insertOutcome, requestRow, SUMMARY, taskRow, TITLE } from './fixtures.ts';

const ERASE_PRIVACY = 'SELECT privacy.erase_subject($1) AS counts';

let tenant: TestTenant;
let member: string;
let person: string;
let live: string;
let request: string;
let task: string;
let kept: string;

beforeAll(async () => {
  tenant = await createTestTenant();
  await asMigratorIn(tenant.id, async (client) => {
    member = await addMember(client, tenant);
    person = await addPerson(client, tenant);
    live = await addPerson(client, tenant);
    request = await insertRow(
      client,
      'privacy.rights_request',
      requestRow(tenant, person, member, { kind: 'erasure' }),
    );
    await insertRow(client, 'privacy.request_clock_event', eventRow(tenant, request, member));
    task = await insertRow(client, 'privacy.request_task', taskRow(tenant, request, member));
    kept = await insertRow(client, 'privacy.rights_request', requestRow(tenant, live, member));
    await insertRow(client, 'privacy.request_task', taskRow(tenant, kept, member));
  });
}, 60_000);

const eraseSubject = (party: string, inTenant: TestTenant | null = tenant) =>
  callAs('app_worker', inTenant ?? undefined, ERASE_PRIVACY, [party]);

const counts = (requests: number, tasks: number) => ({
  'privacy.rights_request': requests,
  'privacy.request_task': tasks,
});

async function state(): Promise<Row[]> {
  return asMigratorIn(tenant.id, async (client) => {
    const { rows } = await client.query<Row>(
      `SELECT r.id, r.kind, r.subject_person_id, r.received_on, r.summary,
              array_agg(t.title ORDER BY t.title) AS titles,
              (SELECT count(*)::int FROM privacy.request_clock_event e
                WHERE e.tenant_id = r.tenant_id AND e.request_id = r.id) AS events
         FROM privacy.rights_request r
         JOIN privacy.request_task t ON t.tenant_id = r.tenant_id AND t.request_id = r.id
        WHERE r.id = ANY ($1)
        GROUP BY r.tenant_id, r.id ORDER BY r.id`,
      [[request, kept]],
    );
    return rows;
  });
}

const cleared = () =>
  [
    {
      id: request,
      kind: 'erasure',
      subject_person_id: person,
      received_on: expect.anything() as unknown,
      summary: null,
      titles: ['erased'],
      events: 1,
    },
    {
      id: kept,
      kind: 'access',
      subject_person_id: live,
      received_on: expect.anything() as unknown,
      summary: SUMMARY,
      titles: [TITLE],
      events: 0,
    },
  ].sort((a, b) => (a.id < b.id ? -1 : 1));

/** Put the pre-erasure values back, as a restore from backup would, past the guards. */
async function restorePreErasure() {
  await asMigratorIn(tenant.id, async (client: pg.ClientBase) => {
    for (const table of ['rights_request', 'request_task']) {
      await client.query(`ALTER TABLE privacy.${table} DISABLE TRIGGER refuse_erased_text`);
    }
    await client.query('UPDATE privacy.rights_request SET summary = $1 WHERE id = $2', [
      SUMMARY,
      request,
    ]);
    await client.query('UPDATE privacy.request_task SET title = $1 WHERE id = $2', [TITLE, task]);
    for (const table of ['rights_request', 'request_task']) {
      await client.query(`ALTER TABLE privacy.${table} ENABLE TRIGGER refuse_erased_text`);
    }
  });
}

describe('privacy.erase_subject', { timeout: 60_000 }, () => {
  it('runs only for app_worker, only for an erased party of the tenant', async () => {
    expect((await callAs('app_api', tenant, ERASE_PRIVACY, [person])).code).toBe('42501');
    expect((await eraseSubject(person)).code).toBe('55000');
    expect((await eraseSubject(person, null)).code).toBe('55000');
  });

  it("keeps the person's requests through their erasure, and clears only their text", async () => {
    const job = await asMigratorIn(tenant.id, (client) =>
      addErasureRequest(client, tenant, member, person),
    );
    expect((await erase(tenant, person, job)).code).toBeUndefined();
    expect((await eraseSubject(person, await createTestTenant())).code).toBe('55000');

    const { row, code } = await eraseSubject(person);
    expect(code).toBeUndefined();
    expect(row?.['counts']).toEqual(counts(1, 1));
    expect(await state()).toEqual(cleared());
    expect((await eraseSubject(person)).row?.['counts']).toEqual(counts(0, 0));
  });

  it('lets app_api clear a summary, and refuses any new text or request about the person', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const summary = (value: string | null) =>
        outcome(client, 'UPDATE privacy.rights_request SET summary = $1 WHERE id = $2', [
          value,
          request,
        ]);
      expect(await summary(SUMMARY)).toBe('55000');
      expect(await summary(null)).toBe('ok');
      expect(
        await outcome(client, 'UPDATE privacy.request_task SET title = $1 WHERE id = $2', [
          TITLE,
          task,
        ]),
      ).toBe('55000');
    });
    expect(
      await insertOutcome(
        'app_api',
        tenant,
        'privacy.rights_request',
        requestRow(tenant, person, member),
      ),
    ).toBe('55000');
    expect(
      await insertOutcome(
        'app_api',
        tenant,
        'privacy.request_task',
        taskRow(tenant, request, member),
      ),
    ).toBe('55000');
  });

  it('clears the pre-erasure rows again after a restore', async () => {
    await restorePreErasure();
    expect((await eraseSubject(person)).row?.['counts']).toEqual(counts(1, 1));
    expect(await state()).toEqual(cleared());
  });

  it('leaves a live person alone', async () => {
    expect((await eraseSubject(live)).code).toBe('55000');
  });
});
