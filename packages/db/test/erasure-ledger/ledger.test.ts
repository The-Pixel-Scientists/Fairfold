// SPDX-License-Identifier: AGPL-3.0-or-later
//
// app.erasure_ledger (migration 0047, ADR 0027): the database writes one row
// for each erasure and destroyed key, in the erasure's transaction. No app
// role writes a row, a tenant sees only its own, and the rows hold ids,
// codes and times only.

import { randomUUID } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import { classification } from '../../classification.ts';
import { expectCrossTenantDenial } from '../cross-tenant.ts';
import { addErasureRequest, callAs, DESTROY, erase, rowsOf } from '../erasure/fixtures.ts';
import { addPerson } from '../party/fixtures.ts';
import {
  addMember,
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  outcome,
  type TestTenant,
} from '../tenants.ts';

const LEDGER = 'app.erasure_ledger';
const BACKUP_READ = `SELECT tenant_id, id, subject_party_id, kind, subject_key_id,
                            audit_event_id, erased_at
                       FROM app.erasure_ledger
                      ORDER BY tenant_id, erased_at, id`;

let tenant: TestTenant;
let other: TestTenant;
let staff: string;

const ledgerOf = (party: string, inTenant = tenant) =>
  rowsOf(inTenant, LEDGER, 'subject_party_id', party);

async function erasedPerson(): Promise<{ party: string; request: string }> {
  return asMigratorIn(tenant.id, async (client) => {
    const party = await addPerson(client, tenant);
    return { party, request: await addErasureRequest(client, tenant, staff, party) };
  });
}

beforeAll(async () => {
  tenant = await createTestTenant();
  other = await createTestTenant();
  staff = await asMigratorIn(tenant.id, (client) => addMember(client, tenant));
}, 60_000);

describe('app.erasure_ledger', { timeout: 30_000 }, () => {
  it('keeps each tenant’s rows from every other', async () => {
    await expectCrossTenantDenial(LEDGER, (_client, inTenant) => ({
      tenant_id: inTenant.id,
      subject_party_id: randomUUID(),
      kind: 'party_erased',
      audit_event_id: randomUUID(),
    }));
  });

  it('lets app_worker read and no app role write', async () => {
    const { party, request } = await erasedPerson();
    expect((await erase(tenant, party, request)).code).toBeUndefined();
    await asRoleIn('app_worker', tenant.id, async (client) => {
      expect((await client.query(`SELECT 1 FROM ${LEDGER}`)).rowCount).toBeGreaterThan(0);
      expect(await outcome(client, `UPDATE ${LEDGER} SET kind = kind`)).toBe('42501');
      expect(await outcome(client, `DELETE FROM ${LEDGER}`)).toBe('42501');
      expect(
        await outcome(
          client,
          `INSERT INTO ${LEDGER} (tenant_id, subject_party_id, kind, audit_event_id)
           VALUES ($1, $2, 'party_erased', $3)`,
          [tenant.id, party, randomUUID()],
        ),
      ).toBe('42501');
    });
    for (const role of ['app_api', 'app_auth', 'app_queue'] as const) {
      await asRoleIn(role, tenant.id, async (client) => {
        expect(await outcome(client, `SELECT 1 FROM ${LEDGER}`), role).toBe('42501');
      });
    }
  });

  it('records an erasure once, with its audit event, in the erasing tenant only', async () => {
    const { party, request } = await erasedPerson();
    const counts = await erase(tenant, party, request);
    expect(counts.code).toBeUndefined();

    const [row, ...rest] = await ledgerOf(party);
    expect(rest).toEqual([]);
    expect(row).toMatchObject({
      tenant_id: tenant.id,
      kind: 'party_erased',
      subject_key_id: null,
    });
    const event = await rowsOf(tenant, 'app.audit_event', 'subject_party_id', party);
    expect(row?.['audit_event_id']).toBe(event[0]?.['id']);
    expect(await ledgerOf(party, other)).toEqual([]);

    expect((await erase(tenant, party, request)).code).toBeUndefined();
    expect(await ledgerOf(party)).toHaveLength(1);
  });

  it('records a destroyed key once, naming the key', async () => {
    const { party, request } = await erasedPerson();
    expect((await erase(tenant, party, request)).code).toBeUndefined();
    expect((await callAs('app_worker', tenant, DESTROY, [party])).row).toEqual({ destroyed: true });
    expect((await callAs('app_worker', tenant, DESTROY, [party])).row).toEqual({
      destroyed: false,
    });

    const [key] = await rowsOf(tenant, 'app.subject_key', 'subject_party_id', party);
    const rows = await ledgerOf(party);
    expect(rows.map((row) => row['kind']).sort()).toEqual([
      'party_erased',
      'subject_key_destroyed',
    ]);
    expect(rows.find((row) => row['kind'] === 'subject_key_destroyed')).toMatchObject({
      subject_key_id: key?.['id'],
    });
  });

  it('writes no row for an event forged by an app role', async () => {
    const party = await asMigratorIn(tenant.id, (client) => addPerson(client, tenant));
    const { code } = await callAs(
      'app_api',
      tenant,
      `INSERT INTO app.audit_event (tenant_id, request_id, actor_kind, action, entity_type,
                                    entity_id, subject_party_id, changes)
       VALUES ($1, $2, 'system', 'party.party.erased', 'party.party', $3, $3, '{}')`,
      [tenant.id, randomUUID(), party],
    );
    expect(code).toBeUndefined();
    expect(await ledgerOf(party)).toEqual([]);
  });

  it('sets the times itself and keeps a row for 7 years', async () => {
    const { party, request } = await erasedPerson();
    expect((await erase(tenant, party, request)).code).toBeUndefined();
    const [row] = await ledgerOf(party);
    const erased = row?.['erased_at'] as Date;
    const until = new Date(erased);
    until.setUTCFullYear(erased.getUTCFullYear() + 7);
    expect(row?.['retain_until']).toEqual(until);
  });

  it('gives the backup read only ids, codes and times', async () => {
    const { party, request } = await erasedPerson();
    expect((await erase(tenant, party, request)).code).toBeUndefined();
    const fields = await asMigratorIn(tenant.id, async (client) => {
      const { fields: columns, rows } = await client.query<{ subject_party_id: string }>(
        BACKUP_READ,
      );
      expect(rows.some((row) => row.subject_party_id === party)).toBe(true);
      return columns.map(({ name }) => name);
    });
    const map = classification[LEDGER] ?? {};
    for (const field of fields) expect(map[field]?.sensitivity, field).toBe('internal');
  });
});
