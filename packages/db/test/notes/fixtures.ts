// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Fixtures for the notes, messages and tags tests (migration 0052), with
// plainly synthetic text. Rows are added through a client with the tenant set.

import type pg from 'pg';
import { expect } from 'vitest';

import type { LoginRole } from '../../scripts/roles.ts';
import { addApplication } from '../grants/application-fixtures.ts';
import { RIGHTS_ROLES, withRoleClient } from '../connect.ts';
import {
  addMember,
  asRoleIn,
  insertRow,
  insertStatement,
  outcome,
  type Row,
  type TestTenant,
} from '../tenants.ts';

export const NOTE_TEXT = 'Synthetic note text';
export const MESSAGE_TEXT = 'Synthetic message text';

export const noteRow = (tenant: TestTenant, author: string, change: Row = {}): Row => ({
  tenant_id: tenant.id,
  body: NOTE_TEXT,
  author_id: author,
  ...change,
});

export const staffMessage = (
  tenant: TestTenant,
  thread: string,
  member: string,
  change: Row = {},
): Row => ({
  tenant_id: tenant.id,
  thread_id: thread,
  side: 'staff',
  body: MESSAGE_TEXT,
  author_membership_id: member,
  ...change,
});

export const applicantMessage = (
  tenant: TestTenant,
  thread: string,
  person: string,
  change: Row = {},
): Row => ({
  tenant_id: tenant.id,
  thread_id: thread,
  side: 'applicant',
  body: MESSAGE_TEXT,
  author_person_id: person,
  ...change,
});

/** A note by a new member, as migrator. */
export async function addNote(client: pg.ClientBase, tenant: TestTenant) {
  const member = await addMember(client, tenant, ['programme_manager']);
  return { member, note: await insertRow(client, 'app.note', noteRow(tenant, member)) };
}

export const addThread = (client: pg.ClientBase, tenant: TestTenant): Promise<string> =>
  insertRow(client, 'app.message_thread', { tenant_id: tenant.id });

/** A new thread joined to a new application, as migrator. */
export async function addLinkedThread(client: pg.ClientBase, tenant: TestTenant) {
  const { id: application, parts } = await addApplication(client, tenant);
  const thread = await addThread(client, tenant);
  await insertRow(client, 'grants.application_message', {
    tenant_id: tenant.id,
    application_id: application,
    thread_id: thread,
  });
  return { application, thread, parts };
}

/** The SQLSTATE of inserting `row` into `table` as `role`, always undone, or ok. */
export function insertOutcome(
  role: LoginRole,
  tenant: TestTenant,
  table: string,
  row: Row,
): Promise<string> {
  return asRoleIn(role, tenant.id, (client) => {
    const { text, values } = insertStatement(client, table, row);
    return outcome(client, text, values);
  });
}

/** Every app role is refused `statement` in `tenant`, for a missing grant or a policy. */
export async function expectEveryRoleRefused(
  tenant: TestTenant,
  statement: string,
  values: readonly unknown[],
): Promise<void> {
  for (const role of RIGHTS_ROLES) {
    await withRoleClient(role, async (client) => {
      await client.query('BEGIN');
      try {
        await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [tenant.id]);
        expect(await outcome(client, statement, values), role).toBe('42501');
      } finally {
        await client.query('ROLLBACK');
      }
    });
  }
}
