// SPDX-License-Identifier: AGPL-3.0-or-later
//
// app_operator (migration 0040, ADR 0009): the NOLOGIN role operator
// commands run as. app_worker holds none of its rights until it sets the
// role, which withOperator() does for one tenant's transaction only. As
// app_operator it holds exactly the rights listed here, and adds only the
// operator's own audit events, in the tenant set. tenant-module-authors
// covers its module switches; the cross-tenant tests of app.audit_event,
// app.tenant_module and app.config_version run as it too (cross-tenant.ts).

import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../../src/database.ts';
import { withOperator } from '../../src/operator.ts';
import { withTenant, type TenantId } from '../../src/tenant-context.ts';
import { databaseSettings, withClient } from '../connect.ts';
import { heldRights } from '../privilege-lint.ts';
import {
  addMember,
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertStatement,
  outcome,
  type Row,
  type TestTenant,
} from '../tenants.ts';

let tenant: TestTenant;
let member: string;
beforeAll(async () => {
  tenant = await createTestTenant();
  member = await asMigratorIn(tenant.id, (client) => addMember(client, tenant));
}, 30_000);

const asOperatorIn = <T>(tenantId: string, work: (client: pg.Client) => Promise<T>) =>
  asRoleIn('app_worker', tenantId, async (client) => {
    await client.query('SET LOCAL ROLE app_operator');
    return work(client);
  });

const event = (change: Row = {}): Row => ({
  tenant_id: tenant.id,
  request_id: randomUUID(),
  actor_kind: 'operator',
  action: 'platform.tenant.created',
  entity_type: 'platform.tenant',
  entity_id: tenant.id,
  changes: {},
  ...change,
});

describe('app_operator', { timeout: 30_000 }, () => {
  // A managed database's admin role keeps ADMIN OPTION on the roles it
  // creates (roles.sql); no other membership is approved.
  it('is NOLOGIN, and app_worker alone may set it, without inheriting its rights', async () => {
    const rows = await withClient('app_worker', async (client) => {
      const role = await client.query(
        "SELECT rolcanlogin, rolbypassrls FROM pg_catalog.pg_roles WHERE rolname = 'app_operator'",
      );
      const members = await client.query(
        `SELECT m.member::regrole::text AS member, m.admin_option, m.inherit_option, m.set_option
           FROM pg_catalog.pg_auth_members m
          WHERE m.roleid = 'app_operator'::regrole AND NOT m.admin_option`,
      );
      return { role: role.rows, members: members.rows };
    });
    expect(rows).toEqual({
      role: [{ rolcanlogin: false, rolbypassrls: false }],
      members: [
        { member: 'app_worker', admin_option: false, inherit_option: false, set_option: true },
      ],
    });
  });

  it('holds exactly the rights migration 0040 grants', async () => {
    const rights = await withClient('app_worker', async (client) =>
      (await heldRights(client, ['app_operator'])).map(
        ({ privilege, object }) => `${privilege} on ${object}`,
      ),
    );
    const columns = (privilege: string, table: string, names: readonly string[]) =>
      names.map((name) => `${privilege} on column ${table}.${name}`);
    expect(rights.sort()).toEqual(
      [
        'USAGE on schema app',
        'EXECUTE on function app.current_tenant_id()',
        'SELECT on app.tenant_module',
        'SELECT on app.config_version',
        'SELECT on app.retention_policy',
        ...columns('INSERT', 'app.tenant_module', [
          'tenant_id',
          'module',
          'enabled',
          'updated_by_kind',
        ]),
        ...columns('INSERT', 'app.config_version', [
          'tenant_id',
          'entity_type',
          'entity_id',
          'version',
          'author_kind',
          'diff',
        ]),
        ...columns('INSERT', 'app.audit_event', [
          'tenant_id',
          'request_id',
          'actor_kind',
          'actor_id',
          'action',
          'entity_type',
          'entity_id',
          'changes',
          'subject_party_id',
        ]),
      ].sort(),
    );
  });

  // 0040 moved the switch rights to app_operator so that a job could never change
  // a switch. The release email job must still skip a module that is off (ADR 0024),
  // so 0045 lets app_worker read which module is on, and nothing more.
  it('leaves app_worker on its own able to read only which module is on', async () => {
    await asRoleIn('app_worker', tenant.id, async (client) => {
      expect(await outcome(client, 'SELECT module, enabled FROM app.tenant_module')).toBe('ok');
      for (const statement of [
        'SELECT updated_by, updated_by_kind FROM app.tenant_module',
        'SELECT 1 FROM app.config_version',
        `INSERT INTO app.tenant_module (tenant_id, module, enabled, updated_by_kind)
         VALUES (app.current_tenant_id(), 'grants', true, 'operator')`,
      ]) {
        expect(await outcome(client, statement), statement).toBe('42501');
      }
    });
  });

  it('adds an operator event in the tenant set, and never changes or removes one', async () => {
    await asOperatorIn(tenant.id, async (client) => {
      const added = event();
      const { text, values } = insertStatement(client, 'app.audit_event', added);
      expect((await client.query(text, values)).rowCount).toBe(1);
      for (const statement of [
        'SELECT 1 FROM app.audit_event',
        'UPDATE app.audit_event SET changes = changes',
        'DELETE FROM app.audit_event',
      ]) {
        expect(await outcome(client, statement), statement).toBe('42501');
      }
    });
  });

  it.each([
    ['a user event', () => event({ actor_kind: 'user', actor_id: member })],
    ['a system event', () => event({ actor_kind: 'system' })],
    ['an event with a subject', () => event({ subject_party_id: randomUUID() })],
  ])('refuses %s', async (_, row: () => Row) => {
    await asOperatorIn(tenant.id, async (client) => {
      const { text, values } = insertStatement(client, 'app.audit_event', row());
      expect(await outcome(client, text, values)).toBe('42501');
    });
  });

  it('cannot add an event to another tenant, or with no tenant set', async () => {
    const other = await createTestTenant();
    for (const set of [other.id, '']) {
      await asOperatorIn(set, async (client) => {
        const { text, values } = insertStatement(client, 'app.audit_event', event());
        expect(await outcome(client, text, values), set || 'no tenant').toBe('42501');
      });
    }
  });
});

describe('withOperator', { timeout: 30_000 }, () => {
  const worker = createDatabase<unknown>(databaseSettings('app_worker', 1));
  afterAll(() => worker.destroy());

  const whoAmI = sql<{ role: string; tenant: string }>`
    SELECT current_user AS role, app.current_tenant_id()::text AS tenant`;

  it('runs as app_operator in the tenant set, and the role ends with the transaction', async () => {
    const id = tenant.id as TenantId;
    const inside = await withOperator(worker, id, async (trx) => (await whoAmI.execute(trx)).rows);
    expect(inside).toEqual([{ role: 'app_operator', tenant: tenant.id }]);

    // One connection in the pool, so this is the same session.
    const after = await withTenant(worker, id, async (trx) => (await whoAmI.execute(trx)).rows);
    expect(after).toEqual([{ role: 'app_worker', tenant: tenant.id }]);
  });
});
