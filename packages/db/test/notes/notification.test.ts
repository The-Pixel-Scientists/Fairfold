// SPDX-License-Identifier: AGPL-3.0-or-later
//
// grants.message_notification (migration 0052): denied across tenants for
// app_api and app_worker, what each may write, the status checks, and the
// queue registered for the job that sends it.

import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import { withClient } from '../connect.ts';
import { expectCrossTenantDenial } from '../cross-tenant.ts';
import { addReleased } from '../grants/decision-fixtures.ts';
import {
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  outcome,
  type Row,
  type TestTenant,
} from '../tenants.ts';
import { addThread, insertOutcome, staffMessage } from './fixtures.ts';

const TABLE = 'grants.message_notification';

async function addNotificationRow(
  client: pg.ClientBase,
  tenant: TestTenant,
  change: Row = {},
): Promise<Row> {
  const released = await addReleased(client, tenant);
  const thread = await addThread(client, tenant);
  const message = await insertRow(
    client,
    'app.message',
    staffMessage(tenant, thread, released.manager),
  );
  return {
    tenant_id: tenant.id,
    message_id: message,
    recipient_person_id: released.parts.person,
    template_version_id: released.template,
    ...change,
  };
}

let tenant: TestTenant;
let row: Row;

beforeAll(async () => {
  tenant = await createTestTenant();
  row = await asMigratorIn(tenant.id, (client) => addNotificationRow(client, tenant));
}, 60_000);

describe('grants.message_notification', { timeout: 30_000 }, () => {
  it('is denied across tenants, for both roles', () =>
    expectCrossTenantDenial(TABLE, (client, inTenant) => addNotificationRow(client, inTenant)));

  it('starts queued, and takes no status, code or send time from app_api', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const id = await insertRow(client, TABLE, row);
      const { rows } = await client.query<{ status: string; error_code: string | null }>(
        `SELECT status, error_code FROM ${TABLE} WHERE id = $1`,
        [id],
      );
      expect(rows[0]).toEqual({ status: 'queued', error_code: null });
    });
    for (const change of [{ status: 'sent' }, { error_code: 'failed' }, { sent_at: new Date() }]) {
      expect(await insertOutcome('app_api', tenant, TABLE, { ...row, ...change })).toBe('42501');
    }
  });

  it('needs a recipient while queued', async () => {
    expect(
      await insertOutcome('app_api', tenant, TABLE, { ...row, recipient_person_id: null }),
    ).toBe('23514');
  });

  it('holds a code exactly when failed and a send time exactly when sent', async () => {
    const id = await asMigratorIn(tenant.id, (client) => insertRow(client, TABLE, row));
    await asRoleIn('app_worker', tenant.id, async (client) => {
      const update = `UPDATE ${TABLE} SET status = $1, error_code = $2, sent_at = $3 WHERE id = $4`;
      expect(await outcome(client, update, ['failed', null, null, id])).toBe('23514');
      expect(await outcome(client, update, ['sent', null, null, id])).toBe('23514');
      expect(await outcome(client, update, ['failed', 'not_a_code', null, id])).toBe('23514');
      expect(await outcome(client, update, ['failed', 'timeout', null, id])).toBe('ok');
      expect(await outcome(client, update, ['sent', null, new Date(), id])).toBe('ok');
      expect(await outcome(client, `UPDATE ${TABLE} SET id = id WHERE id = $1`, [id])).toBe(
        '42501',
      );
    });
  });

  it('is deleted by no app role', async () => {
    const id = await asMigratorIn(tenant.id, (client) => insertRow(client, TABLE, row));
    for (const role of ['app_api', 'app_worker'] as const) {
      await asRoleIn(role, tenant.id, async (client) => {
        expect(await outcome(client, `DELETE FROM ${TABLE} WHERE id = $1`, [id])).toBe('42501');
      });
    }
  });

  it('has its queue and dead-letter queue, of tenant kind', () =>
    withClient('migrator', async (client) => {
      const { rows } = await client.query<{
        name: string;
        kind: string;
        dead_letter: string | null;
      }>(
        `SELECT r.name, r.kind, q.dead_letter
           FROM app.job_queue r JOIN pgboss.queue q ON q.name = r.name
          WHERE r.name LIKE 'grants.message_notification%' ORDER BY r.name`,
      );
      expect(rows).toEqual([
        {
          name: 'grants.message_notification',
          kind: 'tenant',
          dead_letter: 'grants.message_notification.dead',
        },
        { name: 'grants.message_notification.dead', kind: 'tenant', dead_letter: null },
      ]);
    }));
});
