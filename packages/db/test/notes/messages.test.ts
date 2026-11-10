// SPDX-License-Identifier: AGPL-3.0-or-later
//
// app.message_thread, app.message and grants.application_message (migration
// 0052): denied across tenants, the body, side and applicant checks, read
// state moving forward only, one thread per application and the reverse.

import { beforeAll, describe, expect, it } from 'vitest';

import { expectCrossTenantDenial } from '../cross-tenant.ts';
import { addApplication } from '../grants/application-fixtures.ts';
import { addPerson } from '../party/fixtures.ts';
import {
  addMember,
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  outcome,
  type TestTenant,
} from '../tenants.ts';
import {
  addLinkedThread,
  addThread,
  applicantMessage,
  expectEveryRoleRefused,
  insertOutcome,
  staffMessage,
} from './fixtures.ts';

let tenant: TestTenant;
let member: string;
let thread: string;
let applicant: string;
let application: string;
let unlinkedThread: string;
let strangers: { member: string; person: string; thread: string; application: string };

beforeAll(async () => {
  tenant = await createTestTenant();
  const stranger = await createTestTenant();
  await asMigratorIn(tenant.id, async (client) => {
    member = await addMember(client, tenant, ['programme_manager']);
    const added = await addLinkedThread(client, tenant);
    thread = added.thread;
    application = added.application;
    applicant = added.parts.person;
    unlinkedThread = await addThread(client, tenant);
  });
  strangers = await asMigratorIn(stranger.id, async (client) => {
    const { thread: theirs, application: id, parts } = await addLinkedThread(client, stranger);
    return { member: parts.member, person: parts.person, thread: theirs, application: id };
  });
}, 60_000);

const insert = (row: Record<string, unknown>) =>
  insertOutcome('app_api', tenant, 'app.message', row);

describe('app.message_thread', { timeout: 30_000 }, () => {
  it('is denied across tenants', () =>
    expectCrossTenantDenial('app.message_thread', (_client, row) => ({ tenant_id: row.id })));

  it('sets a changed read time itself and leaves the other side alone', async () => {
    const id = await asMigratorIn(tenant.id, (client) => addThread(client, tenant));
    await asRoleIn('app_api', tenant.id, async (client) => {
      await client.query('UPDATE app.message_thread SET staff_read_at = $1 WHERE id = $2', [
        new Date(0),
        id,
      ]);
      const { rows } = await client.query<{ staff_read_at: Date; applicant_read_at: Date | null }>(
        'SELECT staff_read_at, applicant_read_at FROM app.message_thread WHERE id = $1',
        [id],
      );
      expect(rows[0]?.staff_read_at.getTime()).toBeGreaterThan(Date.now() - 60_000);
      expect(rows[0]?.applicant_read_at).toBeNull();
    });
  });

  it('refuses any change outside the read columns', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      expect(await outcome(client, 'UPDATE app.message_thread SET id = id')).toBe('42501');
    });
    await asMigratorIn(tenant.id, async (client) => {
      expect(
        await outcome(client, 'UPDATE app.message_thread SET created_at = $1 WHERE id = $2', [
          new Date(0),
          thread,
        ]),
      ).toBe('23514');
    });
  });

  it('is not deleted by any app role', async () => {
    await expectEveryRoleRefused(tenant, 'DELETE FROM app.message_thread WHERE id = $1', [thread]);
  });
});

describe('app.message', { timeout: 30_000 }, () => {
  it('is denied across tenants', () =>
    expectCrossTenantDenial('app.message', async (client, row) =>
      staffMessage(row, await addThread(client, row), await addMember(client, row)),
    ));

  it.each([
    ['blank', '   '],
    ['untrimmed', 'Synthetic '],
    ['over the limit', 'x'.repeat(2001)],
  ])('refuses a body that is %s', async (_name, body) => {
    expect(await insert(staffMessage(tenant, thread, member, { body }))).toBe('23514');
  });

  it('allows a body at the limit', async () => {
    expect(await insert(staffMessage(tenant, thread, member, { body: 'x'.repeat(2000) }))).toBe(
      'ok',
    );
  });

  it('keeps the author in step with the side', async () => {
    expect(await insert(staffMessage(tenant, thread, member, { author_membership_id: null }))).toBe(
      '23514',
    );
    expect(
      await insert(staffMessage(tenant, thread, member, { author_person_id: applicant })),
    ).toBe('23514');
    expect(
      await insert(applicantMessage(tenant, thread, applicant, { author_membership_id: member })),
    ).toBe('23514');
  });

  it("takes an applicant message only from the thread's application's own applicant", async () => {
    expect(await insert(applicantMessage(tenant, thread, applicant))).toBe('ok');
    const other = await asMigratorIn(tenant.id, (client) => addPerson(client, tenant));
    expect(await insert(applicantMessage(tenant, thread, other))).toBe('23514');
    expect(await insert(applicantMessage(tenant, unlinkedThread, applicant))).toBe('23514');
  });

  it("refuses another tenant's thread, member or person", async () => {
    expect(await insert(staffMessage(tenant, strangers.thread, member))).toBe('23503');
    expect(await insert(staffMessage(tenant, thread, strangers.member))).toBe('23503');
    // The applicant check runs first and sees no such person.
    expect(await insert(applicantMessage(tenant, thread, strangers.person))).toBe('23514');
  });

  it('is append-only for every app role', async () => {
    for (const statement of [
      "UPDATE app.message SET body = 'x' WHERE thread_id = $1",
      'DELETE FROM app.message WHERE thread_id = $1',
    ]) {
      await expectEveryRoleRefused(tenant, statement, [thread]);
    }
  });
});

describe('grants.application_message', { timeout: 30_000 }, () => {
  it('is denied across tenants', () =>
    expectCrossTenantDenial('grants.application_message', async (client, row) => {
      const { id } = await addApplication(client, row);
      return {
        tenant_id: row.id,
        application_id: id,
        thread_id: await addThread(client, row),
      };
    }));

  it("refuses another tenant's thread or application, and a second thread or application", async () => {
    const join = (change: Record<string, unknown>) =>
      insertOutcome('app_api', tenant, 'grants.application_message', {
        tenant_id: tenant.id,
        ...change,
      });
    const free = await asMigratorIn(tenant.id, async (client) => {
      const { id } = await addApplication(client, tenant);
      return { application: id, thread: await addThread(client, tenant) };
    });
    expect(await join({ application_id: free.application, thread_id: strangers.thread })).toBe(
      '23503',
    );
    expect(await join({ application_id: strangers.application, thread_id: free.thread })).toBe(
      '23503',
    );
    expect(await join({ application_id: application, thread_id: free.thread })).toBe('23505');
    expect(await join({ application_id: free.application, thread_id: thread })).toBe('23505');
  });

  it('is append-only for every app role', async () => {
    for (const statement of [
      'UPDATE grants.application_message SET thread_id = thread_id WHERE application_id = $1',
      'DELETE FROM grants.application_message WHERE application_id = $1',
    ]) {
      await expectEveryRoleRefused(tenant, statement, [application]);
    }
  });
});

describe('app.message and its thread for app_worker', { timeout: 30_000 }, () => {
  it('can be read by the notification job', async () => {
    await asMigratorIn(tenant.id, (client) =>
      insertRow(client, 'app.message', staffMessage(tenant, thread, member)),
    );
    await asRoleIn('app_worker', tenant.id, async (client) => {
      expect(await outcome(client, 'SELECT id FROM app.message')).toBe('ok');
      expect(await outcome(client, 'SELECT id FROM app.message_thread')).toBe('ok');
      expect(await outcome(client, 'SELECT id FROM grants.application_message')).toBe('ok');
      expect(await outcome(client, "UPDATE app.message SET body = 'x'")).toBe('42501');
    });
  });
});
