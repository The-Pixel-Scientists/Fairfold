// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The party schema (migration 0005): who may use it, that no app role may
// delete a party row, and party.party, party.organisation and party.person:
// isolation, what app_api may write, each check, and that an organisation
// or person sits only on a party of its own kind.

import { randomUUID } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import { APP_ROLES, withClient } from '../connect.ts';
import { expectCrossTenantDenial } from '../cross-tenant.ts';
import {
  addMember,
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  createTestUser,
  insertStatement,
  outcome,
  type Row,
  type TestTenant,
} from '../tenants.ts';
import {
  addOrganisation,
  addParty,
  addPerson,
  organisationRow,
  PARTY_TABLES,
  personRow,
} from './fixtures.ts';

/** A tenant with a member, an organisation and a person, and a member of another tenant. */
let tenant: TestTenant;
let other: TestTenant;
let member: string;
let stranger: string;
let organisation: string;
let person: string;
beforeAll(async () => {
  [tenant, other] = [await createTestTenant(), await createTestTenant()];
  [member, organisation, person] = await asMigratorIn(tenant.id, async (client) => [
    await addMember(client, tenant),
    await addOrganisation(client, tenant),
    await addPerson(client, tenant),
  ]);
  stranger = await asMigratorIn(other.id, (client) => addMember(client, other));
}, 30_000);

describe('the party schema', { timeout: 30_000 }, () => {
  it('is owned by migrator, and only app_api may use it', async () => {
    const { rows } = await withClient('app_api', (client) =>
      client.query<{ owner: string; users: string[] }>(
        `SELECT n.nspowner::regrole::text AS owner,
                ARRAY(SELECT r.role FROM pg_catalog.unnest($1::text[]) AS r(role)
                       WHERE pg_catalog.has_schema_privilege(r.role, n.oid, 'USAGE')
                       ORDER BY 1) AS users
           FROM pg_catalog.pg_namespace n WHERE n.nspname = 'party'`,
        [APP_ROLES],
      ),
    );
    expect(rows).toEqual([{ owner: 'migrator', users: ['app_api'] }]);
  });

  it('lets no app role delete a row from any party table', async () => {
    const { rows } = await withClient('app_api', (client) =>
      client.query<{ right: string }>(
        `SELECT r.role || ' ' || t.name AS right
           FROM pg_catalog.unnest($1::text[]) AS r(role)
          CROSS JOIN pg_catalog.unnest($2::text[]) AS t(name)
          WHERE pg_catalog.has_table_privilege(r.role, t.name::regclass, 'DELETE')
             OR NOT EXISTS (
                  SELECT 1 FROM pg_catalog.pg_policy p
                   WHERE p.polrelid = t.name::regclass AND p.polname = 'deny_delete'
                     AND NOT p.polpermissive AND p.polcmd = 'd'
                     AND r.role::regrole = ANY (p.polroles))`,
        [APP_ROLES, PARTY_TABLES],
      ),
    );
    expect(rows).toEqual([]);

    await asRoleIn('app_api', tenant.id, async (client) => {
      for (const table of PARTY_TABLES) {
        expect(await outcome(client, `DELETE FROM ${table}`), table).toBe('42501');
      }
    });
  });
});

describe('party.party', { timeout: 30_000 }, () => {
  it("keeps each tenant's parties from every other tenant", async () => {
    await expectCrossTenantDenial('party.party', (_, owner) => ({
      tenant_id: owner.id,
      kind: 'organisation',
    }));
  });

  it('lets app_api add parties and archive them, but not change their kind or tenant', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const { text, values } = insertStatement(client, 'party.party', {
        tenant_id: tenant.id,
        kind: 'person',
        created_by: member,
        updated_by: member,
      });
      const added = await client.query<{ id: string }>(`${text} RETURNING id, status`, values);
      expect(added.rows[0]).toMatchObject({ status: 'active' });

      const archived = await client.query(
        "UPDATE party.party SET status = 'archived' WHERE id = $1 RETURNING status",
        [added.rows[0]?.id],
      );
      expect(archived.rows).toEqual([{ status: 'archived' }]);

      for (const change of ["kind = 'person'", 'tenant_id = tenant_id', 'created_by = NULL']) {
        expect(await outcome(client, `UPDATE party.party SET ${change}`), change).toBe('42501');
      }
      const withId = insertStatement(client, 'party.party', {
        tenant_id: tenant.id,
        id: randomUUID(),
        kind: 'person',
      });
      expect(await outcome(client, withId.text, withId.values)).toBe('42501');
    });
  });

  it.each([
    ['refuses an unknown kind', { kind: 'group' }, '23514'],
    ['refuses an unknown status', { status: 'erased' }, '23514'],
    ['refuses a creator from another tenant', { created_by: 'stranger' }, '23503'],
  ])('%s', async (_, change: Row, expected) => {
    await asRoleIn('migrator', tenant.id, async (client) => {
      const actor = change.created_by ? { created_by: stranger } : {};
      const { text, values } = insertStatement(client, 'party.party', {
        tenant_id: tenant.id,
        kind: 'person',
        ...change,
        ...actor,
      });
      expect(await outcome(client, text, values)).toBe(expected);
    });
  });
});

describe('party.organisation', { timeout: 30_000 }, () => {
  it("keeps each tenant's organisations from every other tenant", async () => {
    await expectCrossTenantDenial('party.organisation', async (client, owner) =>
      organisationRow(owner, await addParty(client, owner, 'organisation')),
    );
  });

  it('lets app_api add and change organisations, but not their id, kind or tenant', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const party = await client.query<{ id: string }>(
        "INSERT INTO party.party (tenant_id, kind) VALUES ($1, 'organisation') RETURNING id",
        [tenant.id],
      );
      const id = party.rows[0]?.id ?? '';
      const { text, values } = insertStatement(
        client,
        'party.organisation',
        organisationRow(tenant, id, { website: 'https://example.org/', created_by: member }),
      );
      expect((await client.query(text, values)).rowCount).toBe(1);

      const changed = await client.query(
        `UPDATE party.organisation SET name = 'Northfield Growers', address_line2 = 'Unit 4',
                updated_by = $2
          WHERE id = $1 RETURNING kind, updated_by`,
        [id, member],
      );
      expect(changed.rows).toEqual([{ kind: 'organisation', updated_by: member }]);

      for (const change of ['id = id', "kind = 'organisation'", 'tenant_id = tenant_id']) {
        expect(await outcome(client, `UPDATE party.organisation SET ${change}`), change).toBe(
          '42501',
        );
      }
    });
  });

  it('sits only on an organisation party', async () => {
    await asRoleIn('migrator', tenant.id, async (client) => {
      const onPerson = insertStatement(
        client,
        'party.organisation',
        organisationRow(tenant, person),
      );
      expect(await outcome(client, onPerson.text, onPerson.values)).toBe('23503');
      const asPerson = insertStatement(
        client,
        'party.organisation',
        organisationRow(tenant, await addParty(client, tenant, 'organisation'), { kind: 'person' }),
      );
      expect(await outcome(client, asPerson.text, asPerson.values)).toBe('23514');
    });
  });

  it.each([
    [
      'accepts a full address and a website',
      { address_line2: 'Unit 4', website: 'https://example.org/grants?id=1' },
      'ok',
    ],
    ['accepts a London postcode', { address_postcode: 'EC1A 1BB' }, 'ok'],
    [
      'accepts a postcode abroad',
      { address_postcode: 'D02 X285', address_country_code: 'IE' },
      'ok',
    ],
    ['refuses a blank name', { name: ' ' }, '23514'],
    ['refuses an untrimmed name', { name: ' Northfield' }, '23514'],
    ['refuses a name with a line break', { name: 'North\nfield' }, '23514'],
    ['refuses a name over 200 characters', { name: 'N'.repeat(201) }, '23514'],
    ['refuses an unknown legal form', { legal_form: 'partnership' }, '23514'],
    ['refuses an empty second line', { address_line2: '' }, '23514'],
    ['refuses a GB postcode not in its normal form', { address_postcode: 'nf12ab' }, '23514'],
    ['refuses a GB postcode that is not one', { address_postcode: 'NOT A CODE' }, '23514'],
    ['refuses a lower-case country code', { address_country_code: 'gb' }, '23514'],
    ['refuses a website without https', { website: 'http://example.org' }, '23514'],
    ['refuses a website with a user name', { website: 'https://user@example.org' }, '23514'],
    ['refuses an empty website', { website: '' }, '23514'],
    ['refuses an updater from another tenant', { updated_by: 'stranger' }, '23503'],
  ])('%s', async (_, change: Row, expected) => {
    await asRoleIn('migrator', tenant.id, async (client) => {
      const actor = change.updated_by ? { updated_by: stranger } : {};
      const id = await addParty(client, tenant, 'organisation');
      const { text, values } = insertStatement(
        client,
        'party.organisation',
        organisationRow(tenant, id, { ...change, ...actor }),
      );
      expect(await outcome(client, text, values)).toBe(expected);
    });
  });
});

describe('party.person', { timeout: 30_000 }, () => {
  it("keeps each tenant's people from every other tenant", async () => {
    await expectCrossTenantDenial('party.person', async (client, owner) =>
      personRow(owner, await addParty(client, owner, 'person'), {
        user_id: await createTestUser(),
      }),
    );
  });

  it('lets app_api add people and change their names and phone, but not their email or account', async () => {
    const user = await createTestUser();
    await asRoleIn('app_api', tenant.id, async (client) => {
      const party = await client.query<{ id: string }>(
        "INSERT INTO party.party (tenant_id, kind) VALUES ($1, 'person') RETURNING id",
        [tenant.id],
      );
      const id = party.rows[0]?.id ?? '';
      const { text, values } = insertStatement(
        client,
        'party.person',
        personRow(tenant, id, { user_id: user, created_by: member }),
      );
      expect((await client.query(text, values)).rowCount).toBe(1);

      const changed = await client.query(
        `UPDATE party.person SET given_name = 'Sam', family_name = 'Example',
                phone = '+44 7700 900123', updated_by = $2
          WHERE id = $1 RETURNING updated_by`,
        [id, member],
      );
      expect(changed.rows).toEqual([{ updated_by: member }]);

      for (const change of ['user_id = NULL', "email = 'other@example.test'", "kind = 'person'"]) {
        expect(await outcome(client, `UPDATE party.person SET ${change}`), change).toBe('42501');
      }
    });
  });

  it('sits only on a person party', async () => {
    await asRoleIn('migrator', tenant.id, async (client) => {
      const onOrganisation = insertStatement(
        client,
        'party.person',
        personRow(tenant, organisation),
      );
      expect(await outcome(client, onOrganisation.text, onOrganisation.values)).toBe('23503');
      const asOrganisation = insertStatement(
        client,
        'party.person',
        personRow(tenant, await addParty(client, tenant, 'person'), { kind: 'organisation' }),
      );
      expect(await outcome(client, asOrganisation.text, asOrganisation.values)).toBe('23514');
    });
  });

  it('links an account to at most one person in each tenant', async () => {
    const user = await createTestUser();
    await asRoleIn('migrator', tenant.id, async (client) => {
      await addPerson(client, tenant, { user_id: user });
      const again = insertStatement(
        client,
        'party.person',
        personRow(tenant, await addParty(client, tenant, 'person'), { user_id: user }),
      );
      expect(await outcome(client, again.text, again.values)).toBe('23505');
      await addPerson(client, tenant);
      await addPerson(client, tenant);

      await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [other.id]);
      const otherTenant = insertStatement(
        client,
        'party.person',
        personRow(other, await addParty(client, other, 'person'), { user_id: user }),
      );
      expect(await outcome(client, otherTenant.text, otherTenant.values)).toBe('ok');
    });
  });

  it.each([
    [
      'accepts names and a phone',
      { given_name: 'Sam', family_name: 'Example', phone: '(01632) 960 001' },
      'ok',
    ],
    ['refuses a blank given name', { given_name: '' }, '23514'],
    ['refuses a family name with a tab', { family_name: 'Ex\tample' }, '23514'],
    ['refuses an email in capitals', { email: 'Sam@Example.test' }, '23514'],
    ['refuses an email without @', { email: 'sam.example.test' }, '23514'],
    ['refuses a phone with letters', { phone: '01632 96000A' }, '23514'],
    ['refuses a phone with too few digits', { phone: '01632 960' }, '23514'],
    ['refuses an empty phone', { phone: '' }, '23514'],
    [
      'refuses a user without an account',
      { user_id: '00000000-0000-4000-8000-000000000000' },
      '23503',
    ],
  ])('%s', async (_, change: Row, expected) => {
    await asRoleIn('migrator', tenant.id, async (client) => {
      const id = await addParty(client, tenant, 'person');
      const { text, values } = insertStatement(
        client,
        'party.person',
        personRow(tenant, id, change),
      );
      expect(await outcome(client, text, values)).toBe(expected);
    });
  });
});
