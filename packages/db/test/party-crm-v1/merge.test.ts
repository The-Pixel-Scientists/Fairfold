// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Merge state on party.party (migration 0020, ADR 0025): a merged party
// names an active survivor of its kind in its tenant, never itself, with no
// chains, and an unmerge clears both together. app_api may write
// merged_into and status, nothing else new.

import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import { addParty } from '../party/fixtures.ts';
import { asMigratorIn, asRoleIn, createTestTenant, outcome, type TestTenant } from '../tenants.ts';

let tenant: TestTenant;
let strangerParty: string;
beforeAll(async () => {
  tenant = await createTestTenant();
  const other = await createTestTenant();
  strangerParty = await asMigratorIn(other.id, (client) => addParty(client, other, 'person'));
}, 30_000);

const MERGE = "UPDATE party.party SET status = 'merged', merged_into = $2 WHERE id = $1";

/** As app_api in the tenant, with `count` new person parties. */
function withPeople(count: number, work: (client: pg.Client, ids: string[]) => Promise<void>) {
  return asRoleIn('app_api', tenant.id, async (client) => {
    const ids: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const { rows } = await client.query<{ id: string }>(
        "INSERT INTO party.party (tenant_id, kind) VALUES ($1, 'person') RETURNING id",
        [tenant.id],
      );
      ids.push(rows[0]?.id ?? '');
    }
    await work(client, ids);
  });
}

describe('party merge state', { timeout: 30_000 }, () => {
  it('lets app_api merge a party into another and reverse it', async () => {
    await withPeople(2, async (client, [loser, survivor]) => {
      expect(await outcome(client, MERGE, [loser, survivor])).toBe('ok');
      const unmerge = `UPDATE party.party SET status = 'active', merged_into = NULL WHERE id = $1`;
      expect(await outcome(client, unmerge, [loser])).toBe('ok');
    });
  });

  it('keeps the merged status and its survivor together', async () => {
    await withPeople(2, async (client, [loser, survivor]) => {
      const set = (change: string) => `UPDATE party.party SET ${change} WHERE id = $1`;
      expect(await outcome(client, set("status = 'merged'"), [loser])).toBe('23514');
      expect(await outcome(client, set('merged_into = $2'), [loser, survivor])).toBe('23514');
      await client.query(MERGE, [loser, survivor]);
      expect(await outcome(client, set("status = 'active'"), [loser])).toBe('23514');
    });
  });

  it('refuses a merge into itself, another kind or another tenant', async () => {
    await withPeople(1, async (client, [loser]) => {
      const { rows } = await client.query<{ id: string }>(
        "INSERT INTO party.party (tenant_id, kind) VALUES ($1, 'organisation') RETURNING id",
        [tenant.id],
      );
      expect(await outcome(client, MERGE, [loser, loser])).toBe('23514');
      expect(await outcome(client, MERGE, [loser, rows[0]?.id])).toBe('23503');
      expect(await outcome(client, MERGE, [loser, strangerParty])).toBe('55000');
    });
  });

  it('refuses chains: into a merged or archived party, or merging a survivor', async () => {
    await withPeople(4, async (client, [first, second, third, archived]) => {
      await client.query("UPDATE party.party SET status = 'archived' WHERE id = $1", [archived]);
      expect(await outcome(client, MERGE, [first, archived])).toBe('55000');
      await client.query(MERGE, [first, second]);
      expect(await outcome(client, MERGE, [third, first])).toBe('55000');
      expect(await outcome(client, MERGE, [second, third])).toBe('55000');

      // The executor moves the parties merged into a survivor first.
      await client.query('UPDATE party.party SET merged_into = $2 WHERE id = $1', [first, third]);
      expect(await outcome(client, MERGE, [second, third])).toBe('ok');
    });
  });

  it('gives app_api no other new right on party.party', async () => {
    await withPeople(1, async (client, [party]) => {
      const added =
        "INSERT INTO party.party (tenant_id, kind, merged_into) VALUES ($1, 'person', $2)";
      expect(await outcome(client, added, [tenant.id, party])).toBe('42501');
      expect(await outcome(client, 'UPDATE party.party SET kind = kind')).toBe('42501');
    });
  });
});
