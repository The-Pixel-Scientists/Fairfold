// SPDX-License-Identifier: AGPL-3.0-or-later
//
// party.organisation_identifier (migration 0005): isolation, what app_api
// may write, and verification: unverified claims may repeat, a verified
// identifier is unique in its tenant, and changing one clears its
// verification.

import { beforeAll, describe, expect, it } from 'vitest';

import { expectCrossTenantDenial } from '../cross-tenant.ts';
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
import { addOrganisation } from './fixtures.ts';

/** A tenant with a member of staff and two organisations, and a member of another tenant. */
let tenant: TestTenant;
let staff: string;
let stranger: string;
let first: string;
let second: string;
beforeAll(async () => {
  tenant = await createTestTenant();
  const other = await createTestTenant();
  [staff, first, second] = await asMigratorIn(tenant.id, async (client) => [
    await addMember(client, tenant),
    await addOrganisation(client, tenant),
    await addOrganisation(client, tenant),
  ]);
  stranger = await asMigratorIn(other.id, (client) => addMember(client, other));
}, 30_000);

function identifier(organisation: string, change: Row = {}): Row {
  return {
    tenant_id: tenant.id,
    organisation_id: organisation,
    scheme: 'GB-CHC',
    identifier: '1234567',
    ...change,
  };
}

/** Columns that mark an identifier as verified by `staff` now. */
function verified(): Row {
  return { verified_at: new Date(), verified_by: staff };
}

describe('party.organisation_identifier', { timeout: 30_000 }, () => {
  it("keeps each tenant's identifiers from every other tenant", async () => {
    await expectCrossTenantDenial('party.organisation_identifier', async (client, owner) => ({
      tenant_id: owner.id,
      organisation_id: await addOrganisation(client, owner),
      scheme: 'GB-COH',
      identifier: '01234567',
    }));
  });

  it('lets app_api add and change identifiers, but never verify one', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const { text, values } = insertStatement(
        client,
        'party.organisation_identifier',
        identifier(first, { created_by: staff }),
      );
      expect((await client.query(text, values)).rowCount).toBe(1);
      const changed = await client.query(
        `UPDATE party.organisation_identifier SET identifier = '1234568', updated_by = $1
          RETURNING updated_by`,
        [staff],
      );
      expect(changed.rows).toEqual([{ updated_by: staff }]);

      const claimed = insertStatement(
        client,
        'party.organisation_identifier',
        identifier(second, verified()),
      );
      expect(await outcome(client, claimed.text, claimed.values)).toBe('42501');
      for (const change of [
        'verified_at = now()',
        'verified_by = updated_by',
        "scheme = 'GB-SC'",
        'organisation_id = organisation_id',
      ]) {
        expect(
          await outcome(client, `UPDATE party.organisation_identifier SET ${change}`),
          change,
        ).toBe('42501');
      }
    });
  });

  it('allows unverified duplicates but refuses a verified one', async () => {
    await asRoleIn('migrator', tenant.id, async (client) => {
      const firstClaim = await insertRow(
        client,
        'party.organisation_identifier',
        identifier(first),
      );
      const claim = insertStatement(client, 'party.organisation_identifier', identifier(second));
      expect(await outcome(client, claim.text, claim.values)).toBe('ok');

      await client.query(
        `UPDATE party.organisation_identifier SET verified_at = now(), verified_by = $2
          WHERE id = $1`,
        [firstClaim, staff],
      );
      expect(await outcome(client, claim.text, claim.values)).toBe('ok');
      const verifiedAgain = insertStatement(
        client,
        'party.organisation_identifier',
        identifier(second, verified()),
      );
      expect(await outcome(client, verifiedAgain.text, verifiedAgain.values)).toBe('23505');
      const otherScheme = insertStatement(
        client,
        'party.organisation_identifier',
        identifier(second, { scheme: 'GB-COH', identifier: '01234567', ...verified() }),
      );
      expect(await outcome(client, otherScheme.text, otherScheme.values)).toBe('ok');
    });
  });

  it('clears the verification of an identifier that changes', async () => {
    await asRoleIn('migrator', tenant.id, async (client) => {
      const id = await insertRow(
        client,
        'party.organisation_identifier',
        identifier(first, verified()),
      );
      const kept = await client.query(
        `UPDATE party.organisation_identifier SET updated_by = $2 WHERE id = $1
          RETURNING verified_at IS NOT NULL AS verified`,
        [id, staff],
      );
      expect(kept.rows).toEqual([{ verified: true }]);
      const changed = await client.query(
        `UPDATE party.organisation_identifier SET identifier = '1234568' WHERE id = $1
          RETURNING verified_at, verified_by`,
        [id],
      );
      expect(changed.rows).toEqual([{ verified_at: null, verified_by: null }]);
    });
  });

  it.each([
    ['accepts a Scottish charity number', { scheme: 'GB-SC', identifier: 'SC012345' }, 'ok'],
    ['accepts a society number', { scheme: 'GB-MPR', identifier: '2468R(S)' }, 'ok'],
    ['refuses an unknown scheme', { scheme: 'GB-EDU' }, '23514'],
    ['refuses an identifier with a space', { identifier: '123 4567' }, '23514'],
    ['refuses an identifier in lower case', { scheme: 'GB-SC', identifier: 'sc012345' }, '23514'],
    ['refuses an empty identifier', { identifier: '' }, '23514'],
    ['refuses a time without a verifier', { verified_at: new Date() }, '23514'],
    ['refuses a verifier without a time', { verified_by: 'staff' }, '23514'],
    [
      'refuses a verifier from another tenant',
      { verified_at: new Date(), verified_by: 'stranger' },
      '23503',
    ],
    [
      'refuses an organisation that does not exist',
      { organisation_id: '00000000-0000-4000-8000-000000000000' },
      '23503',
    ],
  ])('%s', async (_, change: Row, expected) => {
    await asRoleIn('migrator', tenant.id, async (client) => {
      const verifiers: Readonly<Record<string, string>> = { staff, stranger };
      const verifier =
        typeof change.verified_by === 'string' ? verifiers[change.verified_by] : undefined;
      const { text, values } = insertStatement(
        client,
        'party.organisation_identifier',
        identifier(first, { ...change, ...(verifier ? { verified_by: verifier } : {}) }),
      );
      expect(await outcome(client, text, values)).toBe(expected);
    });
  });

  it('holds one identifier per scheme for each organisation', async () => {
    await asRoleIn('migrator', tenant.id, async (client) => {
      await insertRow(client, 'party.organisation_identifier', identifier(first));
      const again = insertStatement(
        client,
        'party.organisation_identifier',
        identifier(first, { identifier: '7654321' }),
      );
      expect(await outcome(client, again.text, again.values)).toBe('23505');
    });
  });
});
