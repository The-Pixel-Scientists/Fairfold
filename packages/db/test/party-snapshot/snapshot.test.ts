// SPDX-License-Identifier: AGPL-3.0-or-later
//
// party.organisation_snapshot (migration 0019): isolation, contents copied
// by the database whatever the caller sends, append-only for every app
// role, and the copied checks, which an erased address still passes.

import { beforeAll, describe, expect, it } from 'vitest';

import { APP_ROLES } from '../connect.ts';
import { expectCrossTenantDenial } from '../cross-tenant.ts';
import { addOrganisation } from '../party/fixtures.ts';
import {
  addMember,
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertStatement,
  outcome,
  type TestTenant,
} from '../tenants.ts';
import { addSnapshot } from './fixtures.ts';

/** A tenant with a member and an organisation with two identifiers, and another tenant's own. */
let tenant: TestTenant;
let member: string;
let organisation: string;
let strangerOrganisation: string;
beforeAll(async () => {
  tenant = await createTestTenant();
  const other = await createTestTenant();
  [member, organisation] = await asMigratorIn(tenant.id, async (client) => {
    const staff = await addMember(client, tenant);
    const id = await addOrganisation(client, tenant, {
      address_line2: 'Unit 4',
      website: 'https://northfield.example',
    });
    await client.query(
      `INSERT INTO party.organisation_identifier
         (tenant_id, organisation_id, scheme, identifier, verified_at, verified_by)
       VALUES ($1, $2, 'GB-COH', '01234567', '2026-10-01T09:30:00.123456Z', $3),
              ($1, $2, 'GB-CHC', '1234567', NULL, NULL)`,
      [tenant.id, id, staff],
    );
    return [staff, id];
  });
  strangerOrganisation = await asMigratorIn(other.id, (client) => addOrganisation(client, other));
}, 30_000);

const COPY = {
  name: 'Northfield Allotment Society',
  legal_form: 'community_benefit_society',
  address_line1: '1 High Street',
  address_line2: 'Unit 4',
  address_town: 'Northfield',
  address_postcode: 'NF1 2AB',
  address_country_code: 'GB',
  website: 'https://northfield.example',
  identifiers: [
    { scheme: 'GB-CHC', identifier: '1234567', verifiedAt: null },
    { scheme: 'GB-COH', identifier: '01234567', verifiedAt: '2026-10-01T09:30:00.123456Z' },
  ],
};

const READ = `SELECT tenant_id, name, legal_form, address_line1, address_line2, address_town,
                     address_postcode, address_country_code, website, identifiers,
                     taken_at = now() AS taken_now
                FROM party.organisation_snapshot WHERE id = $1`;

describe('party.organisation_snapshot', { timeout: 30_000 }, () => {
  it("keeps each tenant's snapshots from every other tenant", async () => {
    await expectCrossTenantDenial('party.organisation_snapshot', async (client, owner) => ({
      tenant_id: owner.id,
      organisation_id: await addOrganisation(client, owner),
      taken_by: await addMember(client, owner),
    }));
  });

  it('copies the organisation and its identifiers as app_api sees them', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const id = await addSnapshot(client, organisation, member);
      const { rows } = await client.query(READ, [id]);
      expect(rows).toEqual([{ tenant_id: tenant.id, ...COPY, taken_now: true }]);
    });
  });

  it('overwrites every copied value a privileged caller forges', async () => {
    const other = await createTestTenant();
    await asRoleIn('migrator', tenant.id, async (client) => {
      const forged = insertStatement(client, 'party.organisation_snapshot', {
        tenant_id: other.id,
        organisation_id: organisation,
        name: 'Forged',
        legal_form: 'other',
        address_line1: 'Forged',
        address_line2: null,
        address_town: 'Forged',
        address_postcode: 'ZZ1 1ZZ',
        address_country_code: 'FR',
        website: null,
        identifiers: JSON.stringify([]),
        taken_by: member,
        taken_at: '2000-01-01T00:00:00Z',
      });
      const { rows } = await client.query<{ id: string }>(`${forged.text} RETURNING id`, [
        ...forged.values,
      ]);
      const read = await client.query(READ, [rows[0]?.id]);
      expect(read.rows).toEqual([{ tenant_id: tenant.id, ...COPY, taken_now: true }]);
    });
  });

  it('lets app_api name only the id, organisation and member', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      for (const [column, value] of Object.entries({ ...COPY, taken_at: new Date() })) {
        const { text, values } = insertStatement(client, 'party.organisation_snapshot', {
          organisation_id: organisation,
          taken_by: member,
          [column]: column === 'identifiers' ? JSON.stringify(value) : value,
        });
        expect(await outcome(client, text, values), column).toBe('42501');
      }
    });
  });

  it("refuses another tenant's organisation, and any with no tenant set", async () => {
    for (const [inTenant, target] of [
      [tenant.id, strangerOrganisation],
      ['', organisation],
    ] as const) {
      await asRoleIn('app_api', inTenant, async (client) => {
        const { text, values } = insertStatement(client, 'party.organisation_snapshot', {
          organisation_id: target,
          taken_by: member,
        });
        expect(await outcome(client, text, values)).toBe('23503');
      });
    }
  });

  it('lets no app role change or remove a snapshot', async () => {
    const id = await asMigratorIn(tenant.id, (client) => addSnapshot(client, organisation, member));
    for (const role of APP_ROLES) {
      await asRoleIn(role, tenant.id, async (client) => {
        const update = 'UPDATE party.organisation_snapshot SET name = name WHERE id = $1';
        expect(await outcome(client, update, [id]), role).toBe('42501');
        const remove = 'DELETE FROM party.organisation_snapshot WHERE id = $1';
        expect(await outcome(client, remove, [id]), role).toBe('42501');
      });
    }
  });

  it.each([
    [
      'accepts the erased address of ADR 0027',
      "address_line1 = 'erased', address_line2 = NULL, address_town = 'erased', " +
        "address_postcode = 'erased', address_country_code = 'ZZ'",
      'ok',
    ],
    ['refuses a GB postcode out of form', "address_postcode = 'nf1 2ab'", '23514'],
    ['refuses an unknown legal form', "legal_form = 'trust'", '23514'],
    ['refuses identifiers that are not an array', "identifiers = '{}'", '23514'],
    ['refuses an identifier that is not an object', `identifiers = '["GB-CHC"]'`, '23514'],
    ['refuses an unknown scheme', 'identifiers = <scheme GB-EDU>', '23514'],
    ['refuses a scheme that is not text', 'identifiers = <scheme 1>', '23514'],
    ['refuses a lower case identifier', 'identifiers = <identifier sc1>', '23514'],
    ['refuses a time with an offset', 'identifiers = <time +01:00>', '23514'],
    ['refuses a missing verification', 'identifiers = <no time>', '23514'],
    ['refuses an extra field', 'identifiers = <extra>', '23514'],
  ])('%s', async (_, change, expected) => {
    const entry = { scheme: 'GB-CHC', identifier: '1234567', verifiedAt: null };
    const identifiers: Readonly<Record<string, unknown>> = {
      '<scheme GB-EDU>': { ...entry, scheme: 'GB-EDU' },
      '<scheme 1>': { ...entry, scheme: 1 },
      '<identifier sc1>': { ...entry, identifier: 'sc1' },
      '<time +01:00>': { ...entry, verifiedAt: '2026-10-01T09:30:00+01:00' },
      '<no time>': { scheme: 'GB-CHC', identifier: '1234567' },
      '<extra>': { ...entry, verifiedBy: member },
    };
    const set = change.replace(/<[^>]+>/, (key) => `'${JSON.stringify([identifiers[key]])}'`);
    await asRoleIn('migrator', tenant.id, async (client) => {
      const id = await addSnapshot(client, organisation, member);
      const valid = `UPDATE party.organisation_snapshot SET identifiers = $2 WHERE id = $1`;
      expect(await outcome(client, valid, [id, JSON.stringify([entry])])).toBe('ok');
      const update = `UPDATE party.organisation_snapshot SET ${set} WHERE id = $1`;
      expect(await outcome(client, update, [id])).toBe(expected);
    });
  });
});
