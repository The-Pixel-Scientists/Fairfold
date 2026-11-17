// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Party's search providers against the test database as app_api, each search
// in its own tenant transaction. Names, emails and identifier values are
// invented.

import {
  normaliseSearchTerm,
  searchResponseSchemas,
  type SearchTerm,
} from '@pixel-scientists/domain/platform/search';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../../../../../packages/db/src/database.ts';
import { trustedTenantId, withTenant } from '../../../../../packages/db/src/tenant-context.ts';
import { databaseSettings } from '../../../../../packages/db/test/connect.ts';
import { addOrganisation, addPerson } from '../../../../../packages/db/test/party/fixtures.ts';
import {
  asMigratorIn,
  createTestTenant,
  insertRow,
  type TestTenant,
} from '../../../../../packages/db/test/tenants.ts';
import type { Tx } from '../tables.ts';
import { organisationSearch, partySearch, personSearch } from './index.ts';

let db: ReturnType<typeof createDatabase<unknown>>;
let a: TestTenant;
let b: TestTenant;

const inTenant = <T>(tenant: TestTenant, work: (tx: Tx) => Promise<T>): Promise<T> =>
  withTenant(db, trustedTenantId(tenant.id), work);

const [organisations, people] = partySearch.map((entry) => entry.search);

/** The hits for a term in one kind of party. */
const find = (
  tenant: TestTenant,
  kind: 'organisation' | 'person',
  text: string,
  limit = 10,
  audience: 'staff' | 'blind_reviewer' = 'staff',
) =>
  inTenant(tenant, async (tx) => {
    const search = kind === 'organisation' ? organisations : people;
    const found = await search?.(tx)({
      term: normaliseSearchTerm(text) as SearchTerm,
      audience,
      limit,
    });
    return found ?? [];
  });

const labels = async (...args: Parameters<typeof find>) =>
  (await find(...args)).map((hit) => hit.label);

const addIdentifier = (tenant: TestTenant, organisation: string, scheme: string, value: string) =>
  asMigratorIn(tenant.id, (client) =>
    insertRow(client, 'party.organisation_identifier', {
      tenant_id: tenant.id,
      organisation_id: organisation,
      scheme,
      identifier: value,
    }),
  );

const person = (tenant: TestTenant, change = {}) =>
  asMigratorIn(tenant.id, (client) => addPerson(client, tenant, change));
const org = (tenant: TestTenant, change = {}) =>
  asMigratorIn(tenant.id, (client) => addOrganisation(client, tenant, change));

const merge = (tenant: TestTenant, loser: string, survivor: string) =>
  asMigratorIn(tenant.id, (client) =>
    client.query("UPDATE party.party SET status = 'merged', merged_into = $2 WHERE id = $1", [
      loser,
      survivor,
    ]),
  );

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
}, 60_000);

afterAll(async () => {
  await db.destroy();
});

describe('the organisation provider', () => {
  it('finds an organisation by part of its name, a slip in it, or its identifier', async () => {
    const id = await org(a, { name: 'Quillfeather Allotment Society' });
    await addIdentifier(a, id, 'GB-COH', '09876543');
    await org(a, { name: 'Marrowby Rowing Club' });

    expect(await labels(a, 'organisation', 'quillfeather allot')).toEqual([
      'Quillfeather Allotment Society',
    ]);
    expect(await labels(a, 'organisation', 'Quilfeather Allotment Society')).toEqual([
      'Quillfeather Allotment Society',
    ]);
    expect(await labels(a, 'organisation', '9876543')).toEqual(['Quillfeather Allotment Society']);
    expect(await labels(a, 'organisation', '0987 6543')).toEqual([
      'Quillfeather Allotment Society',
    ]);
    expect(await labels(a, 'organisation', 'nothing like it zzz')).toEqual([]);
  });

  it('returns a typed id, a label and the module, and nothing else', async () => {
    const id = await org(a, { name: 'Tamsin Woolgar Foundation' });
    expect(await find(a, 'organisation', 'Woolgar Foundation')).toEqual([
      { kind: 'party.organisation', id, label: 'Tamsin Woolgar Foundation', module: 'party' },
    ]);
  });

  it('ranks the closest name first, in a stable order, and honours the limit', async () => {
    await org(a, { name: 'Brindle Hollow Hall' });
    await org(a, { name: 'Brindle Hollow Halls Trust' });
    expect((await labels(a, 'organisation', 'Brindle Hollow Hall'))[0]).toBe('Brindle Hollow Hall');
    expect(await labels(a, 'organisation', 'Brindle Hollow')).toEqual(
      await labels(a, 'organisation', 'Brindle Hollow'),
    );
    expect(await find(a, 'organisation', 'Brindle Hollow', 1)).toHaveLength(1);
  });

  it('never finds a merged organisation, by name or identifier', async () => {
    const loser = await org(a, { name: 'Vellacott Gardens Group' });
    const survivor = await org(a, { name: 'Vellacott Gardens Association' });
    await addIdentifier(a, loser, 'GB-CHC', '9970001');
    await merge(a, loser, survivor);
    expect(await labels(a, 'organisation', 'Vellacott Gardens')).toEqual([
      'Vellacott Gardens Association',
    ]);
    expect(await labels(a, 'organisation', '9970001')).toEqual([]);
  });

  it('finds nothing for an audience that may match on no field', async () => {
    await org(a, { name: 'Dunmere Pottery Circle' });
    expect(await find(a, 'organisation', 'Dunmere Pottery', 10, 'blind_reviewer')).toEqual([]);
  });
});

describe('the person provider', () => {
  it('finds a person by full name, part of a name, a slip, or part of their email', async () => {
    const id = await person(a, {
      given_name: 'Ottoline',
      family_name: 'Wrenfield',
      email: 'ottoline.wrenfield@example.test',
    });
    expect(await find(a, 'person', 'Ottoline Wrenfield')).toEqual([
      { kind: 'party.person', id, label: 'Ottoline Wrenfield', module: 'party' },
    ]);
    expect(await labels(a, 'person', 'wrenf')).toEqual(['Ottoline Wrenfield']);
    expect(await labels(a, 'person', 'Otoline Wrenfield')).toEqual(['Ottoline Wrenfield']);
    expect(await labels(a, 'person', 'wrenfield@example')).toEqual(['Ottoline Wrenfield']);
  });

  it('labels a person with no name by their email', async () => {
    await person(a, { email: 'anon.fennimore@example.test' });
    expect(await labels(a, 'person', 'fennimore@')).toEqual(['anon.fennimore@example.test']);
  });

  it('clips a label to the 200 characters the response allows', async () => {
    const given = `Zyx${'a'.repeat(97)}`;
    const family = `Quorrible${'b'.repeat(91)}`;
    const id = await person(a, { given_name: given, family_name: family });
    const long = `clipmail${'c'.repeat(200)}@example.test`;
    const byEmail = await person(a, { email: long });

    const [named] = await find(a, 'person', 'Quorriblebbb');
    expect(named?.id).toBe(id);
    expect(named?.label).toHaveLength(200);
    expect(named?.label.endsWith('…')).toBe(true);
    expect(`${given} ${family}`.startsWith(named?.label.slice(0, -1) ?? '!')).toBe(true);

    const [mailed] = await find(a, 'person', 'clipmailccc');
    expect(mailed?.id).toBe(byEmail);
    expect(mailed?.label).toHaveLength(200);
    expect(
      searchResponseSchemas.staff.safeParse({
        audience: 'staff',
        groups: [
          {
            module: 'party',
            results: [named, mailed].map((hit) => ({
              kind: hit?.kind,
              id: hit?.id,
              label: hit?.label,
            })),
            more: false,
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('never finds a merged person, or an erased one by their former name or email', async () => {
    const loser = await person(a, {
      given_name: 'Perpetua',
      family_name: 'Halloran',
      email: 'perpetua.halloran@example.test',
    });
    const survivor = await person(a, {
      given_name: 'Perpetua',
      family_name: 'Halloran-Reid',
      email: 'perpetua.reid@example.test',
    });
    await merge(a, loser, survivor);
    expect(await labels(a, 'person', 'Perpetua Halloran')).toEqual(['Perpetua Halloran-Reid']);
    const byEmail = await find(a, 'person', 'perpetua.halloran@');
    expect(byEmail.map((hit) => hit.id)).not.toContain(loser);

    const erased = await person(a, {
      given_name: 'Lysander',
      family_name: 'Thackeray',
      email: 'lysander.thackeray@example.test',
    });
    expect(await labels(a, 'person', 'Lysander Thackeray')).toHaveLength(1);
    await asMigratorIn(a.id, async (client) => {
      await client.query(
        'UPDATE party.person SET given_name = NULL, family_name = NULL, email = id::text || $2 WHERE id = $1',
        [erased, '@erased.invalid'],
      );
      await client.query("UPDATE party.party SET status = 'erased' WHERE id = $1", [erased]);
    });
    expect(await labels(a, 'person', 'Lysander Thackeray')).toEqual([]);
    expect(await labels(a, 'person', 'lysander.thackeray@')).toEqual([]);
    expect(await labels(a, 'person', 'erased.invalid')).toEqual([]);
  });

  it('matches a term with a wildcard or a quote in it only literally', async () => {
    await person(a, {
      given_name: 'Isolde',
      family_name: 'Pemberton',
      email: 'isolde.p@example.test',
    });
    expect(await labels(a, 'person', '%%')).toEqual([]);
    expect(await labels(a, 'person', '____')).toEqual([]);
    expect(await labels(a, 'person', "x' OR '1'='1")).toEqual([]);
  });
});

describe('another tenant', () => {
  it('never finds this tenant’s rows, and has its own with the same values', async () => {
    const [orgA, orgB] = [
      await org(a, { name: 'Greywether Community Orchard' }),
      await org(b, { name: 'Greywether Community Orchard' }),
    ];
    await addIdentifier(a, orgA, 'GB-CHC', '9971234');
    await addIdentifier(b, orgB, 'GB-CHC', '9971234');
    const same = {
      given_name: 'Rosamund',
      family_name: 'Ashdown',
      email: 'rosamund.ashdown@example.test',
    };
    const [personA, personB] = [await person(a, same), await person(b, same)];

    const ids = async (...args: Parameters<typeof find>) =>
      (await find(...args)).map((hit) => hit.id);
    expect(await ids(b, 'organisation', 'Greywether Community Orchard')).toEqual([orgB]);
    expect(await ids(b, 'organisation', '9971234')).toEqual([orgB]);
    expect(await ids(b, 'person', 'rosamund.ashdown@')).toEqual([personB]);
    expect(await ids(a, 'person', 'Rosamund Ashdown')).toEqual([personA]);

    expect(await labels(b, 'organisation', 'Quillfeather')).toEqual([]);
    expect(await labels(b, 'person', 'Ottoline')).toEqual([]);
  });
});

describe('searching', () => {
  it('changes nothing', async () => {
    const count = (tenant: TestTenant) =>
      asMigratorIn(tenant.id, async (client) => {
        const { rows } = await client.query<{ n: string }>(
          `SELECT (SELECT count(*) FROM party.party)
                + (SELECT count(*) FROM party.organisation)
                + (SELECT count(*) FROM party.person)
                + (SELECT count(*) FROM party.organisation_identifier) AS n`,
        );
        return rows[0]?.n;
      });
    const before = await count(a);
    await find(a, 'organisation', 'Quillfeather');
    await find(a, 'person', 'Ottoline');
    expect(await count(a)).toBe(before);
  });

  it('names a read action for people and none for organisations', () => {
    expect(personSearch.readAction).toBe('party.person.viewed');
    expect('readAction' in organisationSearch).toBe(false);
  });
});
