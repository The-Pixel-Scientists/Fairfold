// SPDX-License-Identifier: AGPL-3.0-or-later
//
// party.suppression, the unsubscribe consent source and party.current_consent
// (migration 0072): isolation, append-only with each role's sources, the
// checks and the contract lists they copy, and a view that keeps row-level
// security. packages/db has no dependency on a module, so the contracts are
// loaded by path at run time.

import { randomBytes } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import type { LoginRole } from '../../scripts/roles.ts';
import { expectCrossTenantDenial } from '../cross-tenant.ts';
import { withClient } from '../connect.ts';
import {
  addMember,
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  insertStatement,
  outcome,
  type Row,
  type TestTenant,
} from '../tenants.ts';
import { addPerson } from './fixtures.ts';

interface PartyLists {
  readonly consentPurposes: readonly string[];
  readonly consentChannels: readonly string[];
  readonly suppressionReasons: Readonly<Record<string, string>>;
  readonly staffSuppressionReasons: readonly string[];
}

const LISTS = new URL('../../../../modules/party/src/contracts/lists.ts', import.meta.url);

let tenant: TestTenant;
let other: TestTenant;
let member: string;
let stranger: string;
let person: string;
let strangersPerson: string;

beforeAll(async () => {
  tenant = await createTestTenant();
  other = await createTestTenant();
  [member, person] = await asMigratorIn(tenant.id, async (client) => [
    await addMember(client, tenant),
    await addPerson(client, tenant),
  ]);
  [stranger, strangersPerson] = await asMigratorIn(other.id, async (client) => [
    await addMember(client, other),
    await addPerson(client, other),
  ]);
}, 30_000);

const hash = () => randomBytes(32);

/** A staff entry for `person` in `tenant`, as app_api records one. */
function staffEntry(change: Row = {}): Row {
  return {
    tenant_id: tenant.id,
    person_id: person,
    channel: 'email',
    reason: 'staff_entry',
    source: 'staff',
    address_hash: hash(),
    hash_key_version: 1,
    recorded_by: member,
    ...change,
  };
}

/** A bounce, as the sender in the worker records one. */
const bounce = (change: Row = {}): Row =>
  staffEntry({ reason: 'bounced', source: 'system', recorded_by: null, ...change });

async function insertAs(role: LoginRole, row: Row): Promise<string> {
  return asRoleIn(role, tenant.id, async (client) => {
    const { text, values } = insertStatement(client, 'party.suppression', row);
    return outcome(client, text, values);
  });
}

describe('party.suppression', { timeout: 30_000 }, () => {
  it("keeps each tenant's suppressions from every other tenant", async () => {
    await expectCrossTenantDenial('party.suppression', async (client, owner) => ({
      tenant_id: owner.id,
      person_id: await addPerson(client, owner),
      channel: 'post',
      reason: 'fps_request',
      source: 'staff',
      recorded_by: await addMember(client, owner),
    }));
  });

  it("refuses another tenant's person, and a row for another tenant", async () => {
    expect(await insertAs('app_api', staffEntry({ person_id: strangersPerson }))).toBe('23503');
    expect(
      await insertAs('app_api', staffEntry({ tenant_id: other.id, recorded_by: stranger })),
    ).toBe('42501');
    expect(
      await insertAs(
        'app_api',
        staffEntry({ tenant_id: other.id, person_id: strangersPerson, recorded_by: stranger }),
      ),
    ).toBe('42501');
  });

  it('lets app_api add staff entries and app_worker bounces, and neither change one', async () => {
    expect(await insertAs('app_api', staffEntry())).toBe('ok');
    expect(await insertAs('app_worker', bounce())).toBe('ok');
    expect(await insertAs('app_api', bounce())).toBe('42501');
    expect(await insertAs('app_worker', staffEntry())).toBe('42501');
    const unsubscribe = staffEntry({
      reason: 'unsubscribed',
      source: 'unsubscribe',
      purpose: 'future_funding',
      recorded_by: null,
    });
    expect(await insertAs('app_api', unsubscribe)).toBe('42501');
    expect(await insertAs('app_worker', unsubscribe)).toBe('42501');
    expect(await insertAs('app_api', staffEntry({ recorded_at: new Date(0) }))).toBe('42501');

    for (const role of ['app_api', 'app_worker'] as const) {
      await asRoleIn(role, tenant.id, async (client) => {
        const row = role === 'app_api' ? staffEntry() : bounce();
        const { text, values } = insertStatement(client, 'party.suppression', row);
        await client.query(text, values);
        for (const change of ["reason = 'bounced'", 'recorded_at = now()', 'purpose = NULL']) {
          expect(await outcome(client, `UPDATE party.suppression SET ${change}`), change).toBe(
            '42501',
          );
        }
        expect(await outcome(client, 'DELETE FROM party.suppression')).toBe('42501');
      });
    }
  });

  it('refuses an unknown source, whoever writes it', async () => {
    await asMigratorIn(tenant.id, async (client) => {
      const { text, values } = insertStatement(
        client,
        'party.suppression',
        staffEntry({ source: 'import' }),
      );
      expect(await outcome(client, text, values)).toBe('23514');
    });
  });

  it('sets recorded_at from the database clock', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const { text, values } = insertStatement(client, 'party.suppression', staffEntry());
      const { rows } = await client.query<{ clocked: boolean }>(
        `${text} RETURNING recorded_at > now() AS clocked`,
        values,
      );
      expect(rows).toEqual([{ clocked: true }]);
    });
  });

  it.each([
    ['accepts a staff entry for one purpose', { purpose: 'future_funding' }, 'ok'],
    ['accepts an FPS request on post', fpsOnPost(), 'ok'],
    ['refuses an unknown channel', { channel: 'fax' }, '23514'],
    ['refuses an unknown purpose', { purpose: 'newsletter' }, '23514'],
    ['refuses an unknown reason', { reason: 'moved' }, '23514'],
    ['refuses a staff entry with no member', { recorded_by: null }, '23514'],
    ['refuses a member from another tenant', { recorded_by: '<stranger>' }, '23503'],
    ['refuses a reason staff do not record', { reason: 'complained' }, '23514'],
    [
      'refuses a purpose on an FPS request',
      { reason: 'fps_request', purpose: 'future_funding' },
      '23514',
    ],
    ['refuses a hash of the wrong length', { address_hash: randomBytes(31) }, '23514'],
    ['refuses a hash with no key version', { hash_key_version: null }, '23514'],
    ['refuses a key version with no hash', { address_hash: null }, '23514'],
    ['refuses key version 0', { hash_key_version: 0 }, '23514'],
    ['refuses a hash on post', { channel: 'post' }, '23514'],
    ['refuses no person', { person_id: null }, '23502'],
  ])('%s', async (_, change: Row, expected) => {
    const row = staffEntry(
      change.recorded_by === '<stranger>' ? { recorded_by: stranger } : change,
    );
    expect(await insertAs('app_api', row)).toBe(expected);
  });

  it.each([
    ['accepts a bounce', {}, 'ok'],
    ['refuses a bounce with no hash', { address_hash: null, hash_key_version: null }, '23514'],
    ['refuses a bounce for one purpose', { purpose: 'future_funding' }, '23514'],
    ['refuses a bounce with a member', { recorded_by: '<member>' }, '23514'],
    ['refuses another reason from the system', { reason: 'complained' }, '23514'],
  ])('%s', async (_, change: Row, expected) => {
    const row = bounce(change.recorded_by === '<member>' ? { recorded_by: member } : change);
    expect(await insertAs('app_worker', row)).toBe(expected);
  });
});

function fpsOnPost(): Row {
  return { reason: 'fps_request', channel: 'post', address_hash: null, hash_key_version: null };
}

describe('party.consent after migration 0072', { timeout: 30_000 }, () => {
  const consent = (change: Row = {}): Row => ({
    tenant_id: tenant.id,
    person_id: person,
    purpose: 'future_funding',
    channel: 'email',
    state: 'given',
    privacy_notice_version: 'v1',
    source: 'portal',
    recorded_by: member,
    ...change,
  });

  it.each([
    ['still accepts a portal change', {}, 'ok'],
    ['still accepts a staff change', { source: 'staff' }, 'ok'],
    ['still refuses a portal change with no member', { recorded_by: null }, '23514'],
    ['refuses an unsubscribe from app_api', { source: 'unsubscribe', recorded_by: null }, '42501'],
  ])('%s', async (_, change: Row, expected) => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const { text, values } = insertStatement(client, 'party.consent', consent(change));
      expect(await outcome(client, text, values)).toBe(expected);
    });
  });

  it('refuses an unsubscribe with a member, whoever writes it', async () => {
    await asMigratorIn(tenant.id, async (client) => {
      const row = consent({ state: 'withdrawn', source: 'unsubscribe' });
      const { text, values } = insertStatement(client, 'party.consent', row);
      expect(await outcome(client, text, values)).toBe('23514');
    });
  });

  it('holds every check on the rows that already exist', async () => {
    const { rows } = await withClient('migrator', (client) =>
      client.query<{ name: string; validated: boolean }>(
        `SELECT conname AS name, convalidated AS validated FROM pg_catalog.pg_constraint
          WHERE conrelid = 'party.consent'::regclass AND contype = 'c' ORDER BY 1`,
      ),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((row) => !row.validated)).toEqual([]);
    expect(rows.map((row) => row.name)).toContain('consent_recorded_by');
  });
});

describe('the party lists in migration 0072', { timeout: 30_000 }, () => {
  it("copy S11-44's purposes, channels and reasons", async () => {
    const lists = (await import(LISTS.href)) as PartyLists;
    const checks = await withClient('app_api', async (client) => {
      const { rows } = await client.query<{ name: string; definition: string }>(
        `SELECT o.conname AS name, pg_catalog.pg_get_constraintdef(o.oid) AS definition
           FROM pg_catalog.pg_constraint o
          WHERE o.connamespace = 'party'::regnamespace AND o.contype = 'c'`,
      );
      return new Map(rows.map((row) => [row.name, row.definition]));
    });
    const literals = (name: string) =>
      [...(checks.get(name) ?? '').matchAll(/'([a-z_]+)'::text/g)].map((match) => match[1]);
    for (const table of ['consent', 'suppression']) {
      expect(literals(`${table}_purpose_check`)).toEqual(lists.consentPurposes);
      expect(literals(`${table}_channel_check`)).toEqual(lists.consentChannels);
    }
    expect(literals('suppression_reason_check')).toEqual(Object.keys(lists.suppressionReasons));
    expect(literals('consent_source_check')).toEqual(['portal', 'staff', 'unsubscribe']);
    const staff = /WHEN 'staff'::text THEN \(reason = ANY \(ARRAY\[([^\]]*)\]\)\)/.exec(
      checks.get('suppression_source_reason') ?? '',
    );
    expect([...(staff?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((match) => match[1])).toEqual(
      lists.staffSuppressionReasons,
    );
  });
});

describe('party.current_consent', { timeout: 30_000 }, () => {
  it('runs as its caller', async () => {
    const { rows } = await withClient('migrator', (client) =>
      client.query<{ options: string[] }>(
        `SELECT reloptions AS options FROM pg_catalog.pg_class
          WHERE oid = 'party.current_consent'::regclass`,
      ),
    );
    expect(rows[0]?.options).toContain('security_invoker=true');
  });

  it('gives the latest state and whether a suppression applies, lifted only by the person', async () => {
    const seen = await asMigratorIn(tenant.id, async (client) => {
      const someone = await addPerson(client, tenant);
      const at = (change: Row) =>
        insertRow(client, 'party.consent', {
          tenant_id: tenant.id,
          person_id: someone,
          purpose: 'future_funding',
          privacy_notice_version: 'v1',
          recorded_by: member,
          ...change,
        });
      await at({ channel: 'email', state: 'withdrawn', source: 'portal' });
      await at({ channel: 'email', state: 'given', source: 'portal' });
      await at({ channel: 'sms', state: 'given', source: 'portal' });
      await at({ channel: 'post', state: 'given', source: 'portal' });
      // All marketing by email, then a staff consent, which does not lift it.
      await insertRow(client, 'party.suppression', { ...staffEntry(), person_id: someone });
      await at({ channel: 'email', state: 'given', source: 'staff' });
      // A bounce by SMS matches by address only; a post entry the person then lifts.
      await insertRow(client, 'party.suppression', {
        ...bounce(),
        person_id: someone,
        channel: 'sms',
      });
      await insertRow(client, 'party.suppression', {
        ...staffEntry(fpsOnPost()),
        person_id: someone,
      });
      await at({ channel: 'post', state: 'given', source: 'portal' });
      const { rows } = await client.query<Row>(
        `SELECT channel, state, suppressed FROM party.current_consent
          WHERE person_id = $1 ORDER BY channel`,
        [someone],
      );
      return rows;
    });
    expect(seen).toEqual([
      { channel: 'email', state: 'given', suppressed: true },
      { channel: 'post', state: 'given', suppressed: false },
      { channel: 'sms', state: 'given', suppressed: false },
    ]);
  });

  it("returns only the tenant's own rows, and none with no tenant set", async () => {
    await asMigratorIn(other.id, (client) =>
      insertRow(client, 'party.consent', {
        tenant_id: other.id,
        person_id: strangersPerson,
        purpose: 'future_funding',
        channel: 'email',
        state: 'given',
        privacy_notice_version: 'v1',
        source: 'staff',
        recorded_by: stranger,
      }),
    );
    for (const role of ['app_api', 'app_worker'] as const) {
      await asRoleIn(role, tenant.id, async (client) => {
        const { rows } = await client.query<{ other: string }>(
          `SELECT count(*) FILTER (WHERE tenant_id <> $1) AS other FROM party.current_consent`,
          [tenant.id],
        );
        expect(rows, role).toEqual([{ other: '0' }]);
        await client.query("SELECT pg_catalog.set_config('app.tenant_id', '', true)");
        const none = await client.query('SELECT 1 FROM party.current_consent');
        expect(none.rowCount, role).toBe(0);
      });
    }
    await asRoleIn('app_api', other.id, async (client) => {
      const { rows } = await client.query('SELECT person_id FROM party.current_consent');
      expect(rows).toEqual([{ person_id: strangersPerson }]);
    });
  });
});
