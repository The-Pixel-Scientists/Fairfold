// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Identifier verification (migration 0020): app_api names the verifier, an
// active member of staff in the tenant, and the database alone sets the
// time. A changed identifier still loses its verification, and a value
// verified on another organisation fails on the verified-once index.

import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import { addOrganisation } from '../party/fixtures.ts';
import {
  addMember,
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  outcome,
  type TestTenant,
} from '../tenants.ts';

let tenant: TestTenant;
let staff: string;
let applicant: string;
let removed: string;
let stranger: string;
let first: string;
let second: string;
beforeAll(async () => {
  tenant = await createTestTenant();
  const other = await createTestTenant();
  removed = await asMigratorIn(tenant.id, async (client) => {
    const leaver = await addMember(client, tenant);
    await client.query("UPDATE app.membership SET status = 'removed' WHERE id = $1", [leaver]);
    return leaver;
  });
  [staff, applicant, first, second] = await asMigratorIn(tenant.id, async (client) => [
    await addMember(client, tenant),
    await addMember(client, tenant, ['applicant']),
    await addOrganisation(client, tenant),
    await addOrganisation(client, tenant),
  ]);
  stranger = await asMigratorIn(other.id, (client) => addMember(client, other));
}, 30_000);

/** Add an unverified GB-CHC 1234567 claim to `organisation` and return its id. */
function claim(client: pg.ClientBase, organisation: string): Promise<string> {
  return insertRow(client, 'party.organisation_identifier', {
    tenant_id: tenant.id,
    organisation_id: organisation,
    scheme: 'GB-CHC',
    identifier: '1234567',
  });
}

const VERIFY = `UPDATE party.organisation_identifier SET verified_by = $2 WHERE id = $1
  RETURNING verified_by, verified_at = now() AS now`;

describe('identifier verification', { timeout: 30_000 }, () => {
  it('lets app_api name a member of staff as verifier, and stamps the time itself', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const id = await claim(client, first);
      expect((await client.query(VERIFY, [id, staff])).rows).toEqual([
        { verified_by: staff, now: true },
      ]);
      const forged = "verified_at = '2020-01-01T00:00:00Z'";
      expect(await outcome(client, `UPDATE party.organisation_identifier SET ${forged}`)).toBe(
        '42501',
      );
      const cleared = await client.query(
        `UPDATE party.organisation_identifier SET verified_by = NULL WHERE id = $1
          RETURNING verified_at`,
        [id],
      );
      expect(cleared.rows).toEqual([{ verified_at: null }]);
    });
  });

  it('overwrites a time supplied by a role that may write it', async () => {
    await asRoleIn('migrator', tenant.id, async (client) => {
      const id = await claim(client, first);
      const forged = await client.query(
        `UPDATE party.organisation_identifier
            SET verified_by = $2, verified_at = '2020-01-01T00:00:00Z' WHERE id = $1
          RETURNING verified_at = now() AS now`,
        [id, staff],
      );
      expect(forged.rows).toEqual([{ now: true }]);
      const kept = await client.query(
        `UPDATE party.organisation_identifier SET verified_at = '2020-01-01T00:00:00Z'
          WHERE id = $1 RETURNING verified_at = now() AS now`,
        [id],
      );
      expect(kept.rows).toEqual([{ now: true }]);
    });
  });

  it.each([
    ['an applicant', () => applicant],
    ['a removed member', () => removed],
    ["another tenant's member", () => stranger],
  ])('refuses %s as verifier', async (_, verifier) => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const id = await claim(client, first);
      expect(await outcome(client, VERIFY, [id, verifier()])).toBe('42501');
    });
  });

  it('clears the verification when a contact changes the identifier', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const id = await claim(client, first);
      await client.query(VERIFY, [id, staff]);
      const changed = await client.query(
        `UPDATE party.organisation_identifier SET identifier = '7654321', updated_by = $2
          WHERE id = $1 RETURNING verified_at, verified_by`,
        [id, applicant],
      );
      expect(changed.rows).toEqual([{ verified_at: null, verified_by: null }]);
    });
  });

  it('refuses a value already verified on another organisation, on the unique index', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      await client.query(VERIFY, [await claim(client, first), staff]);
      const again = await claim(client, second);
      await client.query('SAVEPOINT again');
      const error = await client.query(VERIFY, [again, staff]).then(
        () => null,
        (failure: unknown) => failure as { code?: string; constraint?: string },
      );
      await client.query('ROLLBACK TO SAVEPOINT again');
      expect(error).toMatchObject({
        code: '23505',
        constraint: 'organisation_identifier_verified_once',
      });
    });
  });
});
