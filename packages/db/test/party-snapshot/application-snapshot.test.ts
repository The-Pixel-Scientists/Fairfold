// SPDX-License-Identifier: AGPL-3.0-or-later
//
// grants.application.organisation_snapshot_id (migration 0019): only a
// snapshot of the application's own organisation in its tenant, never on a
// draft, set once, and a referenced snapshot is never deleted.

import { beforeAll, describe, expect, it } from 'vitest';

import { addApplication, submit, type Parts } from '../grants/application-fixtures.ts';
import { addOrganisation } from '../party/fixtures.ts';
import { asMigratorIn, asRoleIn, createTestTenant, outcome, type TestTenant } from '../tenants.ts';
import { addSnapshot } from './fixtures.ts';

/** A submitted application and a draft, snapshots of their organisations and of others. */
let tenant: TestTenant;
let submitted: string;
let draft: string;
let draftOwn: string;
let own: string;
let ownLater: string;
let otherOrganisation: string;
let strangers: string;
beforeAll(async () => {
  tenant = await createTestTenant();
  const other = await createTestTenant();
  let parts: Parts;
  ({ id: submitted, parts } = await asMigratorIn(tenant.id, async (client) => {
    const added = await addApplication(client, tenant);
    await submit(client, added.id, added.parts.stages[0]);
    return added;
  }));
  [draft, draftOwn] = await asMigratorIn(tenant.id, async (client) => {
    const added = await addApplication(client, tenant);
    return [added.id, await addSnapshot(client, added.parts.organisation, added.parts.member)];
  });
  [own, ownLater, otherOrganisation] = await asMigratorIn(tenant.id, async (client) => [
    await addSnapshot(client, parts.organisation, parts.member),
    await addSnapshot(client, parts.organisation, parts.member),
    await addSnapshot(client, await addOrganisation(client, tenant), parts.member),
  ]);
  strangers = await asMigratorIn(other.id, async (client) => {
    const { parts: theirs } = await addApplication(client, other);
    return addSnapshot(client, theirs.organisation, theirs.member);
  });
}, 60_000);

const SET = 'UPDATE grants.application SET organisation_snapshot_id = $2 WHERE id = $1';

describe('grants.application.organisation_snapshot_id', { timeout: 30_000 }, () => {
  it("lets app_api set a submitted application's own snapshot once", async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      expect(await outcome(client, SET, [submitted, own])).toBe('ok');
      await client.query(SET, [submitted, own]);
      expect(await outcome(client, SET, [submitted, own]), 'the same again').toBe('ok');
      expect(await outcome(client, SET, [submitted, ownLater]), 'changed').toBe('55000');
      expect(await outcome(client, SET, [submitted, null]), 'cleared').toBe('55000');
    });
  });

  it.each([
    ["refuses another tenant's snapshot", () => [submitted, strangers], '23503'],
    ["refuses another organisation's snapshot", () => [submitted, otherOrganisation], '23503'],
    ['refuses a snapshot on a draft', () => [draft, draftOwn], '23514'],
  ])('%s', async (_, values, expected) => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      expect(await outcome(client, SET, values())).toBe(expected);
    });
  });

  it('keeps the snapshot fixed and in place, even for migrator', async () => {
    await asRoleIn('migrator', tenant.id, async (client) => {
      await client.query(SET, [submitted, own]);
      expect(await outcome(client, SET, [submitted, ownLater])).toBe('55000');
      const remove = 'DELETE FROM party.organisation_snapshot WHERE id = $1';
      expect(await outcome(client, remove, [own])).toBe('23503');
      expect(await outcome(client, remove, [ownLater])).toBe('ok');
    });
  });
});
