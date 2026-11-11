// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The merge executor against the test database as
// app_api, each call in its own tenant transaction. Names, emails and
// identifier values are invented and recognisable. Modules other than party
// are stood in for by re-points that record how they were called.

import { randomUUID } from 'node:crypto';

import { attempt } from '@pixel-scientists/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../../../../packages/db/src/database.ts';
import { trustedTenantId, withTenant } from '../../../../packages/db/src/tenant-context.ts';
import { databaseSettings } from '../../../../packages/db/test/connect.ts';
import { addOrganisation, addPerson } from '../../../../packages/db/test/party/fixtures.ts';
import {
  addMember,
  asMigratorIn,
  createTestTenant,
  createTestUser,
  insertRow,
  type TestTenant,
} from '../../../../packages/db/test/tenants.ts';
import {
  registerRepoints,
  type MergeInput,
  type RepointParty,
  type RepointResult,
} from '../contracts/index.ts';
import type { PartyAudit } from './handlers.ts';
import { createPartyMerges } from './merge.ts';
import { partyRepoint } from './repoint.ts';
import type { PartyRequest } from './request.ts';
import { partyDb, type Tx } from './tables.ts';

const notFound = () => new Error('Not found');

interface Calls {
  readonly seen: MergeInput[];
}

/** A module's re-point that answers `result` and records how it was called. */
function stub(
  module: 'grants' | 'crm' | 'assure' | 'forms' | 'privacy' | 'insight',
  result: RepointResult = { ok: true, rows: [] },
): RepointParty<Tx> & Calls {
  const seen: MergeInput[] = [];
  return {
    module,
    seen,
    repoint: (_tx, input) => Promise.resolve(void seen.push(input)).then(() => result),
    restore: () => Promise.resolve({ ok: false, conflict: 'module_refused' }),
  };
}

let db: ReturnType<typeof createDatabase<unknown>>;
let a: TestTenant;
let b: TestTenant;
let memberA: string;

const inTenant = <T>(tenant: TestTenant, work: (tx: Tx) => Promise<T>): Promise<T> =>
  withTenant(db, trustedTenantId(tenant.id), work);

const query = <T extends object>(tenant: TestTenant, sql: string, values: unknown[] = []) =>
  asMigratorIn(tenant.id, async (client) => (await client.query<T>(sql, values)).rows);

const statusOf = async (tenant: TestTenant, id: string) =>
  (
    await query<{ status: string; merged_into: string | null }>(
      tenant,
      'SELECT status, merged_into FROM party.party WHERE id = $1',
      [id],
    )
  )[0];

function request(tx: Tx, member = memberA) {
  const events: Record<string, unknown>[] = [];
  const audit: PartyAudit = {
    record: (event) => Promise.resolve(void events.push({ read: false, ...event })),
    read: (event) => Promise.resolve(void events.push({ read: true, ...event })),
  };
  return { events, request: { tx, audit, membership: { id: member } } satisfies PartyRequest };
}

/** The executor with every module that holds a party key registered, and the given grants stand-in. */
function merges(...extra: RepointParty<Tx>[]) {
  const others = extra.map(({ module }) => module);
  const fillers = (['grants', 'crm', 'assure', 'forms', 'privacy', 'insight'] as const)
    .filter((module) => !others.includes(module))
    .map((module) => stub(module));
  return createPartyMerges({
    repoints: registerRepoints([partyRepoint, ...extra, ...fillers]),
    notFound,
  });
}

const org = (tenant: TestTenant, change = {}) =>
  asMigratorIn(tenant.id, (client) => addOrganisation(client, tenant, change));
const person = (tenant: TestTenant, change = {}) =>
  asMigratorIn(tenant.id, (client) => addPerson(client, tenant, change));
const link = (tenant: TestTenant, personId: string, organisationId: string) =>
  asMigratorIn(tenant.id, (client) =>
    insertRow(client, 'party.relationship', {
      tenant_id: tenant.id,
      type: 'contact_for',
      subject_id: personId,
      subject_kind: 'person',
      object_id: organisationId,
      object_kind: 'organisation',
    }),
  );
const identifier = (
  tenant: TestTenant,
  organisationId: string,
  scheme: string,
  value: string,
  verifier?: string,
) =>
  asMigratorIn(tenant.id, async (client) => {
    const id = await insertRow(client, 'party.organisation_identifier', {
      tenant_id: tenant.id,
      organisation_id: organisationId,
      scheme,
      identifier: value,
    });
    if (verifier !== undefined) {
      await client.query(
        'UPDATE party.organisation_identifier SET verified_by = $1 WHERE id = $2',
        [verifier, id],
      );
    }
    return id;
  });

beforeAll(async () => {
  const { host, port, database, password } = databaseSettings('app_api', 4);
  db = createDatabase({
    host,
    port,
    database,
    password,
    role: 'app_api',
    maxConnections: 4,
    applicationName: 'tps-db-tests',
  });
  [a, b] = await Promise.all([createTestTenant(), createTestTenant()]);
  memberA = await asMigratorIn(a.id, (client) => addMember(client, a));
}, 60_000);

afterAll(async () => {
  await db.destroy();
});

describe('mergeParties: organisations', () => {
  it('re-points every module, switched off or not, and leaves the loser merged with one audit event', async () => {
    const [loser, survivor, contact] = [
      await org(a, { name: 'Harbour Gardeners' }),
      await org(a, { name: 'Harbour Gardeners Group' }),
      await person(a, { given_name: 'Mira', family_name: 'Quill' }),
    ];
    await link(a, contact, loser);
    await identifier(a, loser, 'GB-CHC', '1000011', memberA);
    await identifier(a, loser, 'GB-COH', '01000012');
    await identifier(a, survivor, 'GB-COH', '01000099');
    await asMigratorIn(a.id, (client) =>
      client.query(
        "INSERT INTO app.tenant_module (tenant_id, module, enabled, updated_by) VALUES ($1, 'grants', false, $2)",
        [a.id, memberA],
      ),
    );
    const grants = stub('grants', {
      ok: true,
      rows: [{ table: 'grants.application', rowId: randomUUID(), change: 'repointed' }],
    });

    const { events, outcome } = await inTenant(a, async (tx) => {
      const { events, request: ctx } = request(tx);
      return {
        events,
        outcome: await merges(grants).mergeParties(ctx, {
          loserId: loser,
          survivorId: survivor,
          kind: 'organisation',
        }),
      };
    });

    expect(grants.seen).toEqual([{ loserId: loser, survivorId: survivor, kind: 'organisation' }]);
    expect(outcome).toEqual({
      merged: true,
      counts: {
        party: { 'party.relationship': 1, 'party.organisation_identifier': 2 },
        grants: { 'grants.application': 1 },
      },
    });
    expect(await statusOf(a, loser)).toEqual({ status: 'merged', merged_into: survivor });
    expect(events).toEqual([
      {
        read: false,
        action: 'party.party.merged',
        entityId: loser,
        changes: {
          'party.party.status': { before: 'active', after: 'merged' },
          'party.party.merged_into': { after: survivor },
        },
      },
    ]);
    expect(JSON.stringify(events)).not.toMatch(/Harbour|Mira|Quill|1000011/);

    const rows = await query<{
      scheme: string;
      organisation_id: string;
      verified_by: string | null;
    }>(
      a,
      'SELECT scheme, organisation_id, verified_by FROM party.organisation_identifier ORDER BY scheme, organisation_id',
    );
    const moved = rows.filter((row) => row.scheme === 'GB-CHC');
    expect(moved).toHaveLength(2);
    expect(moved).toContainEqual(
      expect.objectContaining({ organisation_id: loser, verified_by: null }),
    );
    expect(moved).toContainEqual(
      expect.objectContaining({ organisation_id: survivor, verified_by: memberA }),
    );
    const links = await query<{ ends_on: string | null }>(
      a,
      'SELECT ends_on FROM party.relationship WHERE object_id = $1',
      [loser],
    );
    expect(links[0]?.ends_on).not.toBeNull();
  });

  it('refuses before any write when a module that holds party keys has no re-point', async () => {
    const [loser, survivor] = [await org(a), await org(a)];
    await link(a, await person(a), loser);
    const onlyParty = createPartyMerges({ repoints: registerRepoints([partyRepoint]), notFound });

    const outcome = await inTenant(a, (tx) =>
      onlyParty.mergeParties(request(tx).request, {
        loserId: loser,
        survivorId: survivor,
        kind: 'organisation',
      }),
    );

    expect(outcome).toEqual({ merged: false, conflict: 'module_unregistered' });
    expect((await statusOf(a, loser))?.status).toBe('active');
  });

  it('returns the closed conflict codes before any write', async () => {
    const [loser, survivor, other] = [await org(a), await org(a), await org(a)];
    const merged = await org(a);
    await asMigratorIn(a.id, (client) =>
      client.query("UPDATE party.party SET status = 'merged', merged_into = $2 WHERE id = $1", [
        merged,
        other,
      ]),
    );
    const erased = await asMigratorIn(a.id, async (client) => {
      const id = await addOrganisation(client, a);
      await client.query(
        "UPDATE party.organisation SET address_line1 = 'erased', address_line2 = NULL, address_town = 'erased', address_postcode = 'erased', address_country_code = 'ZZ' WHERE id = $1",
        [id],
      );
      await client.query("UPDATE party.party SET status = 'erased' WHERE id = $1", [id]);
      return id;
    });
    const somebody = await person(a);
    const grants = stub('grants');
    const attempt = (
      loserId: string,
      survivorId: string,
      kind: 'organisation' | 'person' = 'organisation',
    ) =>
      inTenant(a, (tx) =>
        merges(grants).mergeParties(request(tx).request, { loserId, survivorId, kind }),
      );

    expect(await attempt(loser, loser)).toMatchObject({ conflict: 'self_merge' });
    expect(await attempt(loser, somebody)).toMatchObject({ conflict: 'kind_mismatch' });
    expect(await attempt(loser, somebody, 'person')).toMatchObject({ conflict: 'kind_mismatch' });
    expect(await attempt(merged, survivor)).toMatchObject({ conflict: 'party_merged' });
    expect(await attempt(loser, merged)).toMatchObject({ conflict: 'party_merged' });
    expect(await attempt(erased, survivor)).toMatchObject({ conflict: 'party_erased' });
    expect(await attempt(loser, erased)).toMatchObject({ conflict: 'party_erased' });
    expect(grants.seen).toEqual([]);
    expect((await statusOf(a, loser))?.status).toBe('active');
  });

  it('refuses two different verified identifiers of one scheme, or only the loser’s, and writes nothing', async () => {
    const [bothLoser, bothSurvivor, oneLoser, oneSurvivor] = [
      await org(a),
      await org(a),
      await org(a),
      await org(a),
    ];
    await identifier(a, bothLoser, 'GB-CHC', '1000021', memberA);
    await identifier(a, bothSurvivor, 'GB-CHC', '1000022', memberA);
    await identifier(a, oneLoser, 'GB-CHC', '1000023', memberA);
    await identifier(a, oneSurvivor, 'GB-CHC', '1000024');
    const attempt = (loserId: string, survivorId: string) =>
      inTenant(a, (tx) =>
        merges(stub('grants')).mergeParties(request(tx).request, {
          loserId,
          survivorId,
          kind: 'organisation',
        }),
      );

    expect(await attempt(bothLoser, bothSurvivor)).toMatchObject({
      conflict: 'identifiers_both_verified',
    });
    expect(await attempt(oneLoser, oneSurvivor)).toMatchObject({
      conflict: 'loser_identifier_verified',
    });
    expect((await statusOf(a, bothLoser))?.status).toBe('active');
    expect((await statusOf(a, oneLoser))?.status).toBe('active');
  });

  it('rolls the whole merge back when a later module refuses', async () => {
    const [loser, survivor, contact] = [await org(a), await org(a), await person(a)];
    const linkId = await link(a, contact, loser);
    const refusing = stub('grants', { ok: false, conflict: 'module_refused' });

    const outcome = await inTenant(a, async (tx) => {
      const { request: ctx } = request(tx);
      const result = await merges(refusing).mergeParties(ctx, {
        loserId: loser,
        survivorId: survivor,
        kind: 'organisation',
      });
      // Still in the caller's transaction: nothing party wrote stands.
      const [row] = await partyDb(tx)
        .selectFrom('party.relationship')
        .select('ends_on')
        .where('id', '=', linkId)
        .execute();
      return { result, row };
    });

    expect(outcome.result).toEqual({ merged: false, conflict: 'module_refused' });
    expect(outcome.row).toEqual({ ends_on: null });
    expect((await statusOf(a, loser))?.status).toBe('active');
  });

  it('leaves nothing behind when a module’s re-point fails outright', async () => {
    const [loser, survivor, contact] = [await org(a), await org(a), await person(a)];
    await link(a, contact, loser);
    const failing: RepointParty<Tx> = {
      module: 'grants',
      repoint: () => Promise.reject(new Error('a constraint failed')),
      restore: () => Promise.resolve({ ok: false, conflict: 'module_refused' }),
    };

    const merge = inTenant(a, (tx) =>
      merges(failing).mergeParties(request(tx).request, {
        loserId: loser,
        survivorId: survivor,
        kind: 'organisation',
      }),
    );

    await expect(merge).rejects.toThrow();
    expect((await statusOf(a, loser))?.status).toBe('active');
    const links = await query<{ ends_on: string | null }>(
      a,
      'SELECT ends_on FROM party.relationship WHERE object_id = $1',
      [loser],
    );
    expect(links[0]?.ends_on).toBeNull();
  });

  it('undoes the party writes when a module that used attempt() succeeds and a later one refuses', async () => {
    const [loser, survivor, contact] = [await org(a), await org(a), await person(a)];
    const linkId = await link(a, contact, loser);
    await identifier(a, loser, 'GB-COH', '01000031');
    const nesting: RepointParty<Tx> = {
      module: 'grants',
      repoint: async (tx) => {
        await attempt(tx, () => Promise.resolve());
        return { ok: true, rows: [] };
      },
      restore: () => Promise.resolve({ ok: false, conflict: 'module_refused' }),
    };

    const { outcome, events } = await inTenant(a, async (tx) => {
      const { request: ctx, events } = request(tx);
      const outcome = await merges(
        nesting,
        stub('crm', { ok: false, conflict: 'module_refused' }),
      ).mergeParties(ctx, { loserId: loser, survivorId: survivor, kind: 'organisation' });
      return { outcome, events };
    });

    expect(outcome).toEqual({ merged: false, conflict: 'module_refused' });
    expect(events).toEqual([]);
    const links = await query<{ ends_on: string | null }>(
      a,
      'SELECT ends_on FROM party.relationship WHERE id = $1',
      [linkId],
    );
    expect(links[0]?.ends_on).toBeNull();
    const held = await query(
      a,
      'SELECT 1 FROM party.organisation_identifier WHERE organisation_id = $1',
      [survivor],
    );
    expect(held).toHaveLength(0);
    expect((await statusOf(a, loser))?.status).toBe('active');
  });

  it('names the deciding member on the identifier it adds and on its history', async () => {
    const [loser, survivor] = [await org(a), await org(a)];
    await identifier(a, loser, 'GB-COH', '01000041');

    await inTenant(a, (tx) =>
      merges().mergeParties(request(tx).request, {
        loserId: loser,
        survivorId: survivor,
        kind: 'organisation',
      }),
    );

    const [added] = await query<{ created_by: string | null }>(
      a,
      'SELECT created_by FROM party.organisation_identifier WHERE organisation_id = $1',
      [survivor],
    );
    expect(added?.created_by).toBe(memberA);
    const [history] = await query<{ changed_by: string | null }>(
      a,
      "SELECT changed_by FROM party.value_history WHERE party_id = $1 AND field_id = 'organisation.identifier'",
      [survivor],
    );
    expect(history?.changed_by).toBe(memberA);
  });

  it.each(['suspended', 'removed'])(
    'refuses with a conflict, and writes nothing, when the verifier is %s',
    async (status) => {
      const verifier = await asMigratorIn(a.id, (client) => addMember(client, a));
      const [loser, survivor, contact] = [await org(a), await org(a), await person(a)];
      const linkId = await link(a, contact, loser);
      await identifier(a, loser, 'GB-CHC', status === 'removed' ? '1000052' : '1000051', verifier);
      await asMigratorIn(a.id, (client) =>
        client.query('UPDATE app.membership SET status = $2 WHERE id = $1', [verifier, status]),
      );

      const outcome = await inTenant(a, (tx) =>
        merges().mergeParties(request(tx).request, {
          loserId: loser,
          survivorId: survivor,
          kind: 'organisation',
        }),
      );

      expect(outcome).toEqual({ merged: false, conflict: 'module_refused' });
      expect((await statusOf(a, loser))?.status).toBe('active');
      const links = await query<{ ends_on: string | null }>(
        a,
        'SELECT ends_on FROM party.relationship WHERE id = $1',
        [linkId],
      );
      expect(links[0]?.ends_on).toBeNull();
    },
  );

  it('follows parties already merged into the loser to the survivor, so there are no chains', async () => {
    const [earlier, loser, survivor] = [await org(a), await org(a), await org(a)];
    await asMigratorIn(a.id, (client) =>
      client.query("UPDATE party.party SET status = 'merged', merged_into = $2 WHERE id = $1", [
        earlier,
        loser,
      ]),
    );

    const outcome = await inTenant(a, (tx) =>
      merges().mergeParties(request(tx).request, {
        loserId: loser,
        survivorId: survivor,
        kind: 'organisation',
      }),
    );

    expect(outcome).toMatchObject({ merged: true, counts: { party: { 'party.party': 1 } } });
    expect(await statusOf(a, earlier)).toEqual({ status: 'merged', merged_into: survivor });
  });

  it('names a party of another tenant as not found and writes nothing', async () => {
    const [mine, theirs] = [await org(a), await org(b)];
    const grants = stub('grants');

    const merge = inTenant(a, (tx) =>
      merges(grants).mergeParties(request(tx).request, {
        loserId: theirs,
        survivorId: mine,
        kind: 'organisation',
      }),
    );

    await expect(merge).rejects.toThrow('Not found');
    expect(grants.seen).toEqual([]);
    expect((await statusOf(b, theirs))?.status).toBe('active');
  });

  it('rejects an input the contract does not allow', async () => {
    const merge = inTenant(a, (tx) =>
      merges().mergeParties(request(tx).request, {
        loserId: 'x',
        survivorId: 'y',
        kind: 'organisation',
      } as never),
    );
    await expect(merge).rejects.toThrow();
  });
});

describe('mergeParties: people', () => {
  it('carries the loser’s links to the survivor when neither has an account', async () => {
    const [loser, survivor, charity, club] = [
      await person(a),
      await person(a),
      await org(a),
      await org(a),
    ];
    await link(a, loser, charity);
    await link(a, loser, club);
    await link(a, survivor, charity);

    const outcome = await inTenant(a, (tx) =>
      merges().mergeParties(request(tx).request, {
        loserId: loser,
        survivorId: survivor,
        kind: 'person',
      }),
    );

    expect(outcome).toMatchObject({
      merged: true,
      counts: { party: { 'party.relationship': 3 } },
    });
    const current = await query<{ object_id: string }>(
      a,
      'SELECT object_id FROM party.relationship WHERE subject_id = $1 AND ends_on IS NULL ORDER BY object_id',
      [survivor],
    );
    expect(current.map((row) => row.object_id).sort()).toEqual([charity, club].sort());
  });

  it('ends the loser’s links without carrying them when the survivor has an account', async () => {
    const survivorUser = await createTestUser();
    const [loser, survivor, charity] = [
      await person(a),
      await person(a, { user_id: survivorUser }),
      await org(a),
    ];
    await link(a, loser, charity);

    const outcome = await inTenant(a, (tx) =>
      merges().mergeParties(request(tx).request, {
        loserId: loser,
        survivorId: survivor,
        kind: 'person',
      }),
    );

    expect(outcome).toMatchObject({ merged: true, counts: { party: { 'party.relationship': 1 } } });
    expect(
      await query(a, 'SELECT 1 FROM party.relationship WHERE subject_id = $1', [survivor]),
    ).toEqual([]);
  });

  it('refuses two accounts, and an account only on the loser', async () => {
    const [userOne, userTwo] = [await createTestUser(), await createTestUser()];
    const [both, other, withAccount, without] = [
      await person(a, { user_id: userOne }),
      await person(a, { user_id: userTwo }),
      await person(a, { user_id: await createTestUser() }),
      await person(a),
    ];
    const attempt = (loserId: string, survivorId: string) =>
      inTenant(a, (tx) =>
        merges(stub('grants')).mergeParties(request(tx).request, {
          loserId,
          survivorId,
          kind: 'person',
        }),
      );

    expect(await attempt(both, other)).toMatchObject({ conflict: 'both_have_accounts' });
    expect(await attempt(withAccount, without)).toMatchObject({ conflict: 'account_on_loser' });
    expect((await statusOf(a, withAccount))?.status).toBe('active');
  });
});

describe('resolveParty', () => {
  it('follows a merged id to its survivor, and knows no party of another tenant', async () => {
    const [loser, survivor, theirs] = [await org(a), await org(a), await org(b)];
    await inTenant(a, (tx) =>
      merges().mergeParties(request(tx).request, {
        loserId: loser,
        survivorId: survivor,
        kind: 'organisation',
      }),
    );

    const resolve = (id: string) =>
      inTenant(a, (tx) => merges().resolveParty(request(tx).request, id as never));

    expect(await resolve(loser)).toEqual({
      id: survivor,
      kind: 'organisation',
      reachedThroughMerge: true,
    });
    expect(await resolve(survivor)).toEqual({
      id: survivor,
      kind: 'organisation',
      reachedThroughMerge: false,
    });
    expect(await resolve(theirs)).toBeNull();
  });
});
