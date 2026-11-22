// SPDX-License-Identifier: AGPL-3.0-or-later
//
// party.record_unsubscribe() (migration 0073): called as app_api with no
// tenant, as the public unsubscribe route calls it, it records one
// withdrawal and one suppression with their audit events in the named
// tenant only, answers a repeat as already unsubscribed, and refuses,
// writing nothing, anything else. Its owner reads only what it needs.

import { randomBytes, randomUUID } from 'node:crypto';

import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import { asMigratorRolledBack, withClient } from '../connect.ts';
import { addErasureRequest, erase } from '../erasure/fixtures.ts';
import {
  addMember,
  asMigratorIn,
  createTestTenant,
  insertRow,
  outcome,
  type Row,
  type TestTenant,
} from '../tenants.ts';
import { addPerson } from './fixtures.ts';

const CALL = 'SELECT party.record_unsubscribe($1, $2, $3, $4, $5, $6, $7) AS result';

let tenant: TestTenant;
let other: TestTenant;
let suspended: TestTenant;
let member: string;

beforeAll(async () => {
  [tenant, other, suspended] = await Promise.all([
    createTestTenant(),
    createTestTenant(),
    createTestTenant(),
  ]);
  member = await asMigratorIn(tenant.id, (client) => addMember(client, tenant));
  await asMigratorIn(suspended.id, (client) =>
    client.query("UPDATE app.tenant SET status = 'suspended' WHERE id = $1", [suspended.id]),
  );
}, 30_000);

/** A person in `inTenant`, with a given consent by email unless `consented` is false. */
function addConsenting(inTenant: TestTenant, consented = true): Promise<string> {
  return asMigratorIn(inTenant.id, async (client) => {
    const person = await addPerson(client, inTenant);
    if (consented) {
      await insertRow(client, 'party.consent', {
        tenant_id: inTenant.id,
        person_id: person,
        purpose: 'future_funding',
        channel: 'email',
        state: 'given',
        privacy_notice_version: '2026-11',
        source: 'portal',
        recorded_by: await addMember(client, inTenant),
      });
    }
    return person;
  });
}

interface Call {
  tenant: string;
  person: string;
  purpose?: string | null;
  channel?: string | null;
  hash?: Buffer | null;
  version?: number | null;
  request?: string | null;
}

/** Call the function as app_api with no tenant, or with `setTenant` set, and commit. */
function unsubscribe(call: Call, setTenant?: string): Promise<string> {
  return withClient('app_api', async (client) => {
    await client.query('BEGIN');
    if (setTenant) {
      await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [setTenant]);
    }
    const { rows } = await client.query<{ result: string }>(CALL, [
      call.tenant,
      call.person,
      call.purpose === undefined ? 'future_funding' : call.purpose,
      call.channel === undefined ? 'email' : call.channel,
      call.hash === undefined ? HASH : call.hash,
      call.version === undefined ? 1 : call.version,
      call.request === undefined ? randomUUID() : call.request,
    ]);
    await client.query('COMMIT');
    return rows[0]?.result ?? '';
  });
}

const HASH = randomBytes(32);

/** What the function wrote about `person` in `inTenant`, read as migrator. */
function written(inTenant: TestTenant, person: string) {
  return asMigratorIn(inTenant.id, async (client: pg.ClientBase) => {
    const read = async (text: string) => (await client.query<Row>(text, [person])).rows;
    return {
      consent: await read(
        `SELECT state, source, recorded_by, privacy_notice_version FROM party.consent
          WHERE person_id = $1 ORDER BY recorded_at`,
      ),
      suppression: await read(
        `SELECT channel, purpose, reason, source, address_hash, hash_key_version, recorded_by
           FROM party.suppression WHERE person_id = $1 ORDER BY recorded_at`,
      ),
      audit: await read(
        `SELECT action, entity_type, actor_kind, actor_id, changes,
                entity_id IN (SELECT id FROM party.consent UNION ALL
                              SELECT id FROM party.suppression) AS names_row
           FROM app.audit_event WHERE subject_party_id = $1 ORDER BY occurred_at, action`,
      ),
    };
  });
}

describe('party.record_unsubscribe()', { timeout: 60_000 }, () => {
  it('records one withdrawal and suppression with their events, then nothing new', async () => {
    const person = await addConsenting(tenant);
    const request = randomUUID();
    expect(await unsubscribe({ tenant: tenant.id, person, request })).toBe('unsubscribed');
    const first = await written(tenant, person);
    expect(first.consent).toEqual([
      {
        state: 'given',
        source: 'portal',
        recorded_by: expect.any(String) as string,
        privacy_notice_version: '2026-11',
      },
      {
        state: 'withdrawn',
        source: 'unsubscribe',
        recorded_by: null,
        privacy_notice_version: '2026-11',
      },
    ]);
    expect(first.suppression).toEqual([
      {
        channel: 'email',
        purpose: 'future_funding',
        reason: 'unsubscribed',
        source: 'unsubscribe',
        address_hash: HASH,
        hash_key_version: 1,
        recorded_by: null,
      },
    ]);
    expect(first.audit).toEqual([
      {
        action: 'party.consent.recorded',
        entity_type: 'party.consent',
        actor_kind: 'system',
        actor_id: null,
        changes: {
          'party.consent.purpose': {},
          'party.consent.channel': {},
          'party.consent.state': {},
          'party.consent.source': {},
        },
        names_row: true,
      },
      {
        action: 'party.suppression.added',
        entity_type: 'party.suppression',
        actor_kind: 'system',
        actor_id: null,
        changes: {
          'party.suppression.channel': {},
          'party.suppression.purpose': {},
          'party.suppression.reason': {},
          'party.suppression.source': {},
          'party.suppression.address_hash': {},
        },
        names_row: true,
      },
    ]);
    const requests = await asMigratorIn(tenant.id, (client) =>
      client.query('SELECT 1 FROM app.audit_event WHERE request_id = $1', [request]),
    );
    expect(requests.rowCount).toBe(2);

    expect(await unsubscribe({ tenant: tenant.id, person })).toBe('already_unsubscribed');
    expect(await written(tenant, person)).toEqual(first);
  });

  it('records only the suppression when there is no consent to withdraw', async () => {
    const person = await addConsenting(tenant, false);
    expect(await unsubscribe({ tenant: tenant.id, person })).toBe('unsubscribed');
    const seen = await written(tenant, person);
    expect(seen.consent).toEqual([]);
    expect(seen.suppression).toHaveLength(1);
    expect(seen.audit.map((event) => event['action'])).toEqual(['party.suppression.added']);
  });

  it('accepts post with no hash', async () => {
    const person = await addConsenting(tenant, false);
    expect(
      await unsubscribe({ tenant: tenant.id, person, channel: 'post', hash: null, version: null }),
    ).toBe('unsubscribed');
  });

  it('writes nothing in either tenant when a tenant is set', async () => {
    const person = await addConsenting(tenant);
    for (const set of [tenant.id, other.id]) {
      await expect(unsubscribe({ tenant: tenant.id, person }, set)).resolves.toBe('refused');
    }
    expect((await written(tenant, person)).suppression).toEqual([]);
  });

  it('refuses a person who is not in the named tenant, and writes in neither', async () => {
    const theirs = await addConsenting(other);
    expect(await unsubscribe({ tenant: tenant.id, person: theirs })).toBe('refused');
    expect((await written(other, theirs)).suppression).toEqual([]);
  });

  it('refuses an unknown or suspended tenant', async () => {
    const person = await addConsenting(suspended);
    expect(await unsubscribe({ tenant: suspended.id, person })).toBe('refused');
    expect(await unsubscribe({ tenant: randomUUID(), person })).toBe('refused');
    expect((await written(suspended, person)).suppression).toEqual([]);
  });

  it('refuses an erased person', async () => {
    const person = await addConsenting(tenant);
    const request = await asMigratorIn(tenant.id, (client) =>
      addErasureRequest(client, tenant, member, person),
    );
    expect((await erase(tenant, person, request)).code).toBeUndefined();
    expect(await unsubscribe({ tenant: tenant.id, person })).toBe('refused');
    expect((await written(tenant, person)).suppression).toEqual([]);
  });

  it.each([
    ['no purpose', { purpose: null }],
    ['an unknown purpose', { purpose: 'newsletter' }],
    ['no channel', { channel: null }],
    ['an unknown channel', { channel: 'fax' }],
    ['no hash by email', { hash: null, version: null }],
    ['a hash on post', { channel: 'post' }],
    ['a short hash', { hash: randomBytes(31) }],
    ['a hash with no key version', { version: null }],
    ['key version 0', { version: 0 }],
    ['no request id', { request: null }],
  ])('refuses %s, writing nothing', async (_, change: Partial<Call>) => {
    const person = await addConsenting(tenant);
    expect(await unsubscribe({ tenant: tenant.id, person, ...change })).toBe('refused');
    const seen = await written(tenant, person);
    expect(seen.consent).toHaveLength(1);
    expect(seen.suppression).toEqual([]);
    expect(seen.audit).toEqual([]);
  });

  it('may be executed by app_api alone', async () => {
    const { rows } = await withClient('migrator', (client) =>
      client.query<{ role: string }>(
        `SELECT r.rolname AS role FROM pg_catalog.pg_roles r
          WHERE pg_catalog.has_function_privilege(r.oid,
                  'party.record_unsubscribe(uuid, uuid, text, text, bytea, integer, uuid)', 'EXECUTE')
            AND r.rolname IN ('app_api', 'app_worker', 'app_auth', 'app_queue')`,
      ),
    );
    expect(rows).toEqual([{ role: 'app_api' }]);
  });
});

describe("party.record_unsubscribe()'s owner", { timeout: 30_000 }, () => {
  it('reads only the columns it needs, and changes no party', async () => {
    const person = await addConsenting(tenant, false);
    await asMigratorRolledBack(async (client) => {
      await client.query('SET LOCAL ROLE owner_party_record_unsubscribe');
      for (const allowed of [
        'SELECT id, status FROM app.tenant',
        'SELECT tenant_id, id FROM party.person',
        'SELECT reason, address_hash FROM party.suppression',
      ]) {
        expect(await outcome(client, allowed), allowed).toBe('ok');
      }
      for (const refused of [
        'SELECT name FROM app.tenant',
        'SELECT email FROM party.person',
        'SELECT given_name FROM party.person',
        'SELECT recorded_by FROM party.consent',
        'SELECT recorded_by FROM party.suppression',
        'SELECT 1 FROM party.organisation',
        'SELECT 1 FROM app.membership',
        'SELECT changes FROM app.audit_event',
        `UPDATE party.party SET status = 'archived' WHERE id = '${person}'`,
        `UPDATE party.party SET updated_at = now() WHERE id = '${person}'`,
      ]) {
        expect(await outcome(client, refused), refused).toBe('42501');
      }
    });
  });
});
