// SPDX-License-Identifier: AGPL-3.0-or-later
//
// grants.form_version (migration 0010): isolation, one draft per round, a
// draft published or discarded, a published version that no role can
// change or remove, the key that pins a version to its round, and each
// check.

import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import { asMigratorRolledBack } from '../connect.ts';
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
import { addRound } from './fixtures.ts';

/** A definition in S05-01's shape: one section with one question. */
const DEFINITION = {
  sections: [
    {
      id: 's_about',
      title: 'About your project',
      fields: [{ id: 'f_name', type: 'short_text', label: 'Project name', required: true }],
    },
  ],
};

function draftRow(tenant: TestTenant, roundId: string, change: Row = {}): Row {
  return { tenant_id: tenant.id, round_id: roundId, version: 1, definition: DEFINITION, ...change };
}

/** Publish the draft `id` as `member`. */
function publish(client: pg.ClientBase, id: string, member: string) {
  return client.query(
    `UPDATE grants.form_version
        SET status = 'published', published_at = now(), published_by = $2, updated_by = $2
      WHERE id = $1`,
    [id, member],
  );
}

/** A tenant with a member and a round, and another tenant's member and round. */
let tenant: TestTenant;
let member: string;
let round: string;
let stranger: string;
let strangersRound: string;
beforeAll(async () => {
  tenant = await createTestTenant();
  const other = await createTestTenant();
  [member, round] = await asMigratorIn(tenant.id, async (client) => [
    await addMember(client, tenant),
    await addRound(client, tenant),
  ]);
  [stranger, strangersRound] = await asMigratorIn(other.id, async (client) => [
    await addMember(client, other),
    await addRound(client, other),
  ]);
}, 30_000);

describe('grants.form_version', { timeout: 30_000 }, () => {
  it("keeps each tenant's form versions from every other tenant", async () => {
    await expectCrossTenantDenial('grants.form_version', async (client, owner) =>
      draftRow(owner, await addRound(client, owner)),
    );
  });

  it('lets app_api save, publish and discard drafts, one draft per round at a time', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const roundId = await addRound(client, tenant);
      const first = await insertRow(
        client,
        'grants.form_version',
        draftRow(tenant, roundId, { definition: null, created_by: member }),
      );
      const second = insertStatement(
        client,
        'grants.form_version',
        draftRow(tenant, roundId, { version: 2 }),
      );
      expect(await outcome(client, second.text, second.values)).toBe('23505');

      const saved = await client.query(
        'UPDATE grants.form_version SET definition = $2, updated_by = $3 WHERE id = $1',
        [first, DEFINITION, member],
      );
      expect(saved.rowCount).toBe(1);
      expect((await publish(client, first, member)).rowCount).toBe(1);

      const next = await insertRow(
        client,
        'grants.form_version',
        draftRow(tenant, roundId, { version: 2 }),
      );
      const { rows } = await client.query(
        `SELECT version, status, published_at IS NOT NULL AS stamped FROM grants.form_version
          WHERE round_id = $1 ORDER BY version`,
        [roundId],
      );
      expect(rows).toEqual([
        { version: 1, status: 'published', stamped: true },
        { version: 2, status: 'draft', stamped: false },
      ]);

      const discarded = await client.query('DELETE FROM grants.form_version WHERE id = $1', [next]);
      expect(discarded.rowCount).toBe(1);

      for (const change of [
        'round_id = round_id',
        'version = 3',
        'id = id',
        'tenant_id = tenant_id',
      ]) {
        expect(await outcome(client, `UPDATE grants.form_version SET ${change}`), change).toBe(
          '42501',
        );
      }
    });
  });

  it('never changes or removes a published version, for app_api or migrator', async () => {
    const id = await asMigratorIn(tenant.id, async (client) => {
      const roundId = await addRound(client, tenant);
      const draft = await insertRow(client, 'grants.form_version', draftRow(tenant, roundId));
      await publish(client, draft, member);
      return draft;
    });
    const changes = [
      "definition = '{}'",
      "status = 'draft', published_at = NULL, published_by = NULL",
      'published_at = now()',
      'updated_by = updated_by',
    ];
    for (const role of ['app_api', 'migrator'] as const) {
      await asRoleIn(role, tenant.id, async (client) => {
        for (const change of changes) {
          const updated = await client.query(
            `UPDATE grants.form_version SET ${change} WHERE id = $1`,
            [id],
          );
          expect(updated.rowCount, `${role}: ${change}`).toBe(0);
        }
        const deleted = await client.query('DELETE FROM grants.form_version WHERE id = $1', [id]);
        expect(deleted.rowCount, `${role}: delete`).toBe(0);
        const { rows } = await client.query(
          'SELECT status, definition FROM grants.form_version WHERE id = $1',
          [id],
        );
        expect(rows).toEqual([{ status: 'published', definition: DEFINITION }]);
      });
    }
  });

  it('pins a version to its own round through (tenant_id, round_id, id), published or not', async () => {
    const [published, otherRound] = await asMigratorIn(tenant.id, async (client) => {
      const draft = await insertRow(client, 'grants.form_version', draftRow(tenant, round));
      await publish(client, draft, member);
      return [draft, await addRound(client, tenant)];
    });
    const results = await asMigratorRolledBack(async (client) => {
      await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [tenant.id]);
      await client.query(`
        CREATE TABLE grants.form_version_reference (
          tenant_id uuid NOT NULL, round_id uuid NOT NULL, form_version_id uuid NOT NULL,
          FOREIGN KEY (tenant_id, round_id, form_version_id)
            REFERENCES grants.form_version (tenant_id, round_id, id))`);
      const insert = 'INSERT INTO grants.form_version_reference VALUES ($1, $2, $3)';
      return [
        await outcome(client, insert, [tenant.id, round, published]),
        await outcome(client, insert, [tenant.id, otherRound, published]),
      ];
    });
    expect(results).toEqual(['ok', '23503']);
  });

  it.each([
    ['accepts a definition at the size limit', { definition: { a: 'x'.repeat(524_279) } }, 'ok'],
    [
      'refuses a definition over the size limit',
      { definition: { a: 'x'.repeat(524_280) } },
      '23514',
    ],
    ['refuses a definition that is a list', { definition: JSON.stringify([DEFINITION]) }, '23514'],
    ['refuses a definition that is text', { definition: JSON.stringify('form') }, '23514'],
    ['refuses version 0', { version: 0 }, '23514'],
    ['refuses no round', { round_id: null }, '23502'],
    ["refuses another tenant's round", { round_id: '<strangers round>' }, '23503'],
    ['refuses a creator from another tenant', { created_by: '<stranger>' }, '23503'],
    ['refuses a new published version', { status: 'published' }, '42501'],
  ])('%s', async (_, change: Row, expected) => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const ids: Readonly<Record<string, string>> = {
        '<stranger>': stranger,
        '<strangers round>': strangersRound,
      };
      const values = Object.fromEntries(
        Object.entries(change).map(([column, value]) => [
          column,
          typeof value === 'string' ? (ids[value] ?? value) : value,
        ]),
      );
      const roundId = await addRound(client, tenant);
      const statement = insertStatement(
        client,
        'grants.form_version',
        draftRow(tenant, roundId, values),
      );
      expect(await outcome(client, statement.text, statement.values)).toBe(expected);
    });
  });

  it.each([
    ['refuses an unknown status', "status = 'archived'", '23514'],
    [
      'refuses publishing without a time',
      "status = 'published', published_by = '<member>'",
      '23514',
    ],
    ['refuses publishing without an author', "status = 'published', published_at = now()", '23514'],
    ['refuses a publication time on a draft', 'published_at = now()', '23514'],
    [
      'refuses publishing an empty draft',
      "status = 'published', published_at = now(), published_by = '<member>', definition = NULL",
      '23514',
    ],
    [
      'refuses a publisher from another tenant',
      "status = 'published', published_at = now(), published_by = '<stranger>'",
      '23503',
    ],
  ])('%s', async (_, change, expected) => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const roundId = await addRound(client, tenant);
      const id = await insertRow(client, 'grants.form_version', draftRow(tenant, roundId));
      const set = change.replace('<member>', member).replace('<stranger>', stranger);
      const update = `UPDATE grants.form_version SET ${set} WHERE id = $1`;
      expect(await outcome(client, update, [id])).toBe(expected);
    });
  });
});
