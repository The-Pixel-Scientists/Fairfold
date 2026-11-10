// SPDX-License-Identifier: AGPL-3.0-or-later
//
// app.subject_key and app.destroy_subject_key() (migration 0033, ADR 0027):
// a key is its tenant's alone; app roles read and add live keys only, and
// never change or remove one; only app_worker destroys one, through the
// function, once its party is erased, keeping the row and writing one
// event. subjectKey() gets or makes a key in the transaction's tenant.

import { randomBytes } from 'node:crypto';

import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../../src/database.ts';
import { keyEncryptionKeys, subjectKey } from '../../src/subject-keys.ts';
import { trustedTenantId, withTenant } from '../../src/tenant-context.ts';
import { databaseSettings } from '../connect.ts';
import { expectCrossTenantDenial } from '../cross-tenant.ts';
import { addParty, addPerson } from '../party/fixtures.ts';
import {
  addMember,
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertStatement,
  outcome,
  type TestTenant,
} from '../tenants.ts';
import { addErasureRequest, callAs, DESTROY, erase, rowsOf } from './fixtures.ts';

const KEYS = 'app.subject_key';
const keys = keyEncryptionKeys(1, 'k'.repeat(48));

let tenant: TestTenant;
let other: TestTenant;
let person: string;
let keyless: string;
let personRequest: string;
let keylessRequest: string;
let worker: Kysely<unknown>;

beforeAll(async () => {
  tenant = await createTestTenant();
  other = await createTestTenant();
  worker = createDatabase<unknown>(databaseSettings('app_worker', 2));
  await asMigratorIn(tenant.id, async (client) => {
    const staff = await addMember(client, tenant);
    [person, keyless] = [await addPerson(client, tenant), await addPerson(client, tenant)];
    personRequest = await addErasureRequest(client, tenant, staff, person);
    keylessRequest = await addErasureRequest(client, tenant, staff, keyless);
  });
}, 60_000);

afterAll(async () => {
  await worker.destroy();
});

const keyOf = (party: string) =>
  withTenant(worker, trustedTenantId(tenant.id), (trx) => subjectKey(trx, keys, party));

describe('app.subject_key', { timeout: 30_000 }, () => {
  it('keeps each tenant’s keys from every other', async () => {
    await expectCrossTenantDenial('app.subject_key', async (client, inTenant) => ({
      tenant_id: inTenant.id,
      subject_party_id: await addParty(client, inTenant, 'person'),
      wrapped_key: randomBytes(60),
      kek_version: 1,
    }));
  });

  it('lets app roles add live keys only, and never change or remove one', async () => {
    const party = await asMigratorIn(tenant.id, (client) => addParty(client, tenant, 'person'));
    for (const role of ['app_api', 'app_worker'] as const) {
      await asRoleIn(role, tenant.id, async (client) => {
        const row = { tenant_id: tenant.id, subject_party_id: party, kek_version: 1 };
        const dead = insertStatement(client, KEYS, { ...row, wrapped_key: null });
        expect(await outcome(client, dead.text, dead.values), `${role} adds a dead key`).toBe(
          '23514',
        );
        const destroyed = insertStatement(client, KEYS, { ...row, destroyed_at: new Date() });
        expect(await outcome(client, destroyed.text, destroyed.values)).toBe('42501');
        const live = insertStatement(client, KEYS, { ...row, wrapped_key: randomBytes(60) });
        await client.query(live.text, live.values);
        for (const change of [
          'UPDATE app.subject_key SET wrapped_key = NULL',
          'UPDATE app.subject_key SET tenant_id = tenant_id',
          'DELETE FROM app.subject_key',
        ]) {
          expect(await outcome(client, change), `${role}: ${change}`).toBe('42501');
        }
      });
    }
  });

  it('gives a subject one key, read back the same in the same tenant', async () => {
    const first = await keyOf(person);
    expect(first.kind).toBe('live');
    expect(await keyOf(person)).toEqual(first);
    const [row] = await rowsOf(tenant, KEYS, 'subject_party_id', person);
    expect(row).toMatchObject({ kek_version: 1, destroyed_at: null });
  });
});

describe('app.destroy_subject_key', { timeout: 30_000 }, () => {
  it.each(['app_api', 'app_auth', 'app_queue'] as const)('cannot be called by %s', async (role) => {
    expect((await callAs(role, tenant, DESTROY, [person])).code).toBe('42501');
  });

  it('refuses a party that is not erased, or with no tenant', async () => {
    expect((await callAs('app_worker', tenant, DESTROY, [person])).code).toBe('55000');
    expect((await callAs('app_worker', undefined, DESTROY, [person])).code).toBe('55000');
    expect(await rowsOf(tenant, KEYS, 'subject_party_id', person)).toMatchObject([
      { destroyed_at: null },
    ]);
  });

  it('destroys an erased party’s key once, keeping the row, and audits it', async () => {
    expect((await erase(tenant, person, personRequest)).code).toBeUndefined();

    expect((await callAs('app_worker', other, DESTROY, [person])).code).toBe('55000');
    expect((await callAs('app_worker', tenant, DESTROY, [person])).row).toEqual({
      destroyed: true,
    });
    const [row] = await rowsOf(tenant, KEYS, 'subject_party_id', person);
    expect(row).toMatchObject({ wrapped_key: null, destroyed_at: expect.any(Date) as Date });
    expect(await keyOf(person)).toEqual({ kind: 'erased' });

    expect((await callAs('app_worker', tenant, DESTROY, [person])).row).toEqual({
      destroyed: false,
    });
    const events = await rowsOf(tenant, 'app.audit_event', 'subject_party_id', person);
    expect(
      events.filter((event) => event.action === 'platform.subject_key.destroyed'),
    ).toMatchObject([
      {
        actor_kind: 'system',
        entity_type: 'platform.subject_key',
        entity_id: row?.id,
        changes: {},
      },
    ]);

    expect((await erase(tenant, keyless, keylessRequest)).code).toBeUndefined();
    expect((await callAs('app_worker', tenant, DESTROY, [keyless])).row).toEqual({
      destroyed: true,
    });
    expect(await keyOf(keyless)).toEqual({ kind: 'erased' });
  });
});
