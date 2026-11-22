// SPDX-License-Identifier: AGPL-3.0-or-later
//
// app.event_outbox and app.event_sequence (migration 0097): isolation between
// tenants, the checks, the number and times the database sets, append-only
// rows that only app_worker deletes once expired, and a counter that only
// goes up by one. Also the relay's queues (migration 0098).

import { randomUUID } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import { withClient, withRoleClient } from '../connect.ts';
import { expectCrossTenantDenial } from '../cross-tenant.ts';
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
import {
  beginIn,
  eventRow,
  expiredTimes,
  insertEvent,
  OUTBOX,
  withRetentionTriggerOff,
} from './fixtures.ts';

let tenant: TestTenant;
let other: TestTenant;
let member: string;
let stranger: string;
beforeAll(async () => {
  [tenant, other] = [await createTestTenant(), await createTestTenant()];
  member = await asMigratorIn(tenant.id, (client) => addMember(client, tenant));
  stranger = await asMigratorIn(other.id, (client) => addMember(client, other));
}, 30_000);

describe('app.event_outbox', { timeout: 30_000 }, () => {
  it("keeps each tenant's events from every other tenant, for every role with a grant", async () => {
    // Expired, so that app_worker, which deletes only expired events, may
    // delete its own tenant's.
    await withRetentionTriggerOff(() =>
      expectCrossTenantDenial(OUTBOX, (_, owner) => ({ ...eventRow(owner), ...expiredTimes() })),
    );
  });

  it('numbers and times each event itself, whatever the insert supplies', async () => {
    const fresh = await createTestTenant();
    const rows = await asMigratorIn(fresh.id, async (client) => {
      const past = { sequence: 999, occurred_at: new Date(0), retain_until: new Date(0) };
      await insertEvent(client, { ...eventRow(fresh), ...past });
      await insertEvent(client, { ...eventRow(fresh), ...past });
      const result = await client.query<{ sequence: string; kept: boolean; recent: boolean }>(
        `SELECT sequence,
                retain_until = ((occurred_at AT TIME ZONE 'UTC') + interval '90 days')
                               AT TIME ZONE 'UTC' AS kept,
                occurred_at = now() AS recent
           FROM app.event_outbox ORDER BY sequence`,
      );
      return result.rows;
    });
    expect(rows).toEqual([
      { sequence: '1', kept: true, recent: true },
      { sequence: '2', kept: true, recent: true },
    ]);
  });

  it.each<[string, () => Row, string]>([
    ['accepts the causing member', () => ({ caused_by: member }), 'ok'],
    ['refuses a member of another tenant', () => ({ caused_by: stranger }), '23503'],
    ['refuses a name in capitals', () => ({ type: 'Grants.outbox_test.v1' }), '23514'],
    ['refuses a name with no version', () => ({ type: 'grants.outbox_test' }), '23514'],
    ['refuses version 0', () => ({ type: 'grants.outbox_test.v0' }), '23514'],
    ['refuses a payload that is a list', () => ({ payload: '[]' }), '23514'],
    ['refuses a payload that is a string', () => ({ payload: '"x"' }), '23514'],
    [
      'refuses a payload over 8 KiB',
      () => ({ payload: JSON.stringify({ ids: Array.from({ length: 250 }, () => randomUUID()) }) }),
      '23514',
    ],
  ])('%s', async (_, change, expected) => {
    const result = await asRoleIn('app_api', tenant.id, (client) => {
      const { text, values } = insertStatement(client, OUTBOX, eventRow(tenant, change()));
      return outcome(client, text, values);
    });
    expect(result).toBe(expected);
  });

  it('lets no app role change an event', async () => {
    for (const role of ['app_api', 'app_worker', 'app_operator'] as const) {
      await withRoleClient(role, async (client) => {
        await beginIn(client, tenant);
        try {
          const result = await outcome(client, `UPDATE app.event_outbox SET request_id = $1`, [
            randomUUID(),
          ]);
          expect(result, role).toBe('42501');
        } finally {
          await client.query('ROLLBACK');
        }
      });
    }
  });

  it('lets app_worker delete only expired events, and no other app role delete any', async () => {
    const fresh = eventRow(tenant);
    const expired = { ...eventRow(tenant), ...expiredTimes() };
    await asMigratorIn(tenant.id, (client) => insertEvent(client, fresh));
    await withRetentionTriggerOff(() =>
      asMigratorIn(tenant.id, (client) => insertEvent(client, expired)),
    );
    const remove = 'DELETE FROM app.event_outbox WHERE id = ANY($1)';
    const ids = [fresh['id'], expired['id']];
    expect(await asRoleIn('app_api', tenant.id, (client) => outcome(client, remove, [ids]))).toBe(
      '42501',
    );
    const deleted = await asRoleIn('app_worker', tenant.id, async (client) => {
      const { rows } = await client.query<{ id: string }>(`${remove} RETURNING id`, [ids]);
      return rows.map((row) => row.id);
    });
    expect(deleted).toEqual([expired['id']]);
  });
});

describe('app.event_sequence', { timeout: 30_000 }, () => {
  it("keeps each tenant's counter from every other tenant, for every role with a grant", async () => {
    await expectCrossTenantDenial('app.event_sequence', (_, owner) => ({
      tenant_id: owner.id,
      last_sequence: 1,
    }));
  });

  it('starts a counter at 1 and lets it go up by one only', async () => {
    const fresh = await createTestTenant();
    const results = await withClient('app_api', async (client) => {
      await beginIn(client, fresh);
      try {
        const step = (text: string) => outcome(client, text);
        return [
          await step(
            'INSERT INTO app.event_sequence (tenant_id, last_sequence) VALUES (app.current_tenant_id(), 5)',
          ),
          await step(
            'INSERT INTO app.event_sequence (tenant_id, last_sequence) VALUES (app.current_tenant_id(), 1)',
          ),
          await client
            .query(
              'INSERT INTO app.event_sequence (tenant_id, last_sequence) VALUES (app.current_tenant_id(), 1)',
            )
            .then(() => 'ok'),
          await step('UPDATE app.event_sequence SET last_sequence = last_sequence + 2'),
          await step('UPDATE app.event_sequence SET last_sequence = last_sequence - 1'),
          await step('UPDATE app.event_sequence SET last_sequence = last_sequence'),
          await step('UPDATE app.event_sequence SET last_sequence = last_sequence + 1'),
          await step('DELETE FROM app.event_sequence'),
        ];
      } finally {
        await client.query('ROLLBACK');
      }
    });
    expect(results).toEqual(['55000', 'ok', 'ok', '55000', '55000', 'ok', 'ok', '42501']);
  });
});

describe('the relay queues', () => {
  it('are registered with their kinds and dead-letter queues', async () => {
    const rows = await withClient('migrator', async (client) => {
      const result = await client.query<{ name: string; kind: string; dead_letter: string }>(
        `SELECT j.name, j.kind, q.dead_letter FROM app.job_queue j
           JOIN pgboss.queue q ON q.name = j.name
          WHERE j.name LIKE 'platform.outbox%' OR j.name LIKE 'outbox.%' ORDER BY j.name`,
      );
      return result.rows;
    });
    expect(rows).toEqual([
      { name: 'outbox.probe', kind: 'tenant', dead_letter: 'outbox.probe.dead' },
      { name: 'outbox.probe.dead', kind: 'tenant', dead_letter: null },
      {
        name: 'platform.outbox_relay',
        kind: 'platform',
        dead_letter: 'platform.outbox_relay.dead',
      },
      { name: 'platform.outbox_relay.dead', kind: 'platform', dead_letter: null },
      {
        name: 'platform.outbox_tenant',
        kind: 'tenant',
        dead_letter: 'platform.outbox_tenant.dead',
      },
      { name: 'platform.outbox_tenant.dead', kind: 'tenant', dead_letter: null },
    ]);
  });
});
