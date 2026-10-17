// SPDX-License-Identifier: AGPL-3.0-or-later
//
// grants.stage and grants.rubric_criterion (migration 0009): isolation,
// what app_api may write and delete, reordering and renaming in one
// transaction, the key that pins a stage to its round, and each check.

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
import {
  addCriterion,
  addProgramme,
  addRound,
  addStage,
  criterionRow,
  roundRow,
  stageRow,
} from './fixtures.ts';

/** A tenant with a member, a programme and a round, and another tenant's member, round and stage. */
let tenant: TestTenant;
let member: string;
let programme: string;
let round: string;
let stranger: string;
let strangersRound: string;
let strangersStage: string;
beforeAll(async () => {
  tenant = await createTestTenant();
  const other = await createTestTenant();
  [member, programme] = await asMigratorIn(tenant.id, async (client) => [
    await addMember(client, tenant),
    await addProgramme(client, tenant),
  ]);
  round = await asMigratorIn(tenant.id, (client) =>
    insertRow(client, 'grants.round', roundRow(tenant, programme)),
  );
  [stranger, strangersRound] = await asMigratorIn(other.id, async (client) => [
    await addMember(client, other),
    await addRound(client, other),
  ]);
  strangersStage = await asMigratorIn(other.id, (client) =>
    addStage(client, other, strangersRound),
  );
}, 30_000);

/** `change` with '<stranger>', '<strangers round>' and '<strangers stage>' put in. */
function resolved(change: Row): Row {
  const ids: Readonly<Record<string, string>> = {
    '<stranger>': stranger,
    '<strangers round>': strangersRound,
    '<strangers stage>': strangersStage,
  };
  return Object.fromEntries(
    Object.entries(change).map(([column, value]) => [
      column,
      typeof value === 'string' ? (ids[value] ?? value) : value,
    ]),
  );
}

/** Add stages Intake, Review and Decision to a new round and return their ids. */
async function addThreeStages(client: pg.ClientBase): Promise<string[]> {
  const roundId = await insertRow(client, 'grants.round', roundRow(tenant, programme));
  const ids: string[] = [];
  for (const [index, name] of ['Intake', 'Review', 'Decision'].entries()) {
    const row = stageRow(tenant, roundId, { name, position: index + 1 });
    ids.push(await insertRow(client, 'grants.stage', row));
  }
  return ids;
}

/** Check every deferred constraint now: ok, or the SQLSTATE of the first that fails. */
function checkNow(client: pg.ClientBase): Promise<string> {
  return outcome(client, 'SET CONSTRAINTS ALL IMMEDIATE');
}

describe('grants.stage', { timeout: 30_000 }, () => {
  it("keeps each tenant's stages from every other tenant", async () => {
    await expectCrossTenantDenial('grants.stage', async (client, owner) =>
      stageRow(owner, await addRound(client, owner)),
    );
  });

  it('lets app_api add, rename, reorder and delete stages, but not move them to another round', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const [intake = '', review = '', decision = ''] = await addThreeStages(client);

      // Swap two positions one row at a time, then all three in one statement.
      await client.query('UPDATE grants.stage SET position = 2, updated_by = $2 WHERE id = $1', [
        intake,
        member,
      ]);
      await client.query('UPDATE grants.stage SET position = 1 WHERE id = $1', [review]);
      expect(await checkNow(client)).toBe('ok');
      await client.query(
        `UPDATE grants.stage SET position = CASE id WHEN $1 THEN 3 WHEN $2 THEN 2 ELSE 1 END
          WHERE id IN ($1, $2, $3)`,
        [intake, review, decision],
      );
      expect(await checkNow(client)).toBe('ok');

      // Swap two names, one row at a time.
      await client.query("UPDATE grants.stage SET name = 'Review' WHERE id = $1", [intake]);
      await client.query("UPDATE grants.stage SET name = 'Intake' WHERE id = $1", [review]);
      expect(await checkNow(client)).toBe('ok');

      for (const change of ['round_id = round_id', 'tenant_id = tenant_id', 'id = id']) {
        expect(await outcome(client, `UPDATE grants.stage SET ${change}`), change).toBe('42501');
      }

      const removed = await client.query('DELETE FROM grants.stage WHERE id = $1', [decision]);
      expect(removed.rowCount).toBe(1);
    });
  });

  it('refuses at commit a position or a name, in any case, that another stage of the round has', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const [, review = ''] = await addThreeStages(client);
      await client.query('SAVEPOINT duplicate');
      await client.query('UPDATE grants.stage SET position = 1 WHERE id = $1', [review]);
      expect(await checkNow(client)).toBe('23505');
      await client.query('ROLLBACK TO SAVEPOINT duplicate');

      await client.query("UPDATE grants.stage SET name = 'intake' WHERE id = $1", [review]);
      expect(await checkNow(client)).toBe('23P01');
      await client.query('ROLLBACK TO SAVEPOINT duplicate');

      // The same name and position in another round are fine.
      await insertRow(client, 'grants.stage', stageRow(tenant, round, { name: 'Intake' }));
      expect(await checkNow(client)).toBe('ok');
    });
  });

  it('pins a stage to its own round through (tenant_id, round_id, id)', async () => {
    const [stage, otherRound] = await asMigratorIn(tenant.id, async (client) => [
      await addStage(client, tenant, round, { name: 'Pinned', position: 9 }),
      await insertRow(client, 'grants.round', roundRow(tenant, programme)),
    ]);
    const results = await asMigratorRolledBack(async (client) => {
      await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [tenant.id]);
      await client.query(`
        CREATE TABLE grants.stage_reference (
          tenant_id uuid NOT NULL, round_id uuid NOT NULL, stage_id uuid NOT NULL,
          FOREIGN KEY (tenant_id, round_id, stage_id)
            REFERENCES grants.stage (tenant_id, round_id, id))`);
      const insert = 'INSERT INTO grants.stage_reference VALUES ($1, $2, $3)';
      return [
        await outcome(client, insert, [tenant.id, round, stage]),
        await outcome(client, insert, [tenant.id, otherRound, stage]),
      ];
    });
    expect(results).toEqual(['ok', '23503']);
  });

  it.each([
    ['accepts a name of 60 characters', { name: 'N'.repeat(60) }, 'ok'],
    ['refuses an empty name', { name: '' }, '23514'],
    ['refuses a name over 60 characters', { name: 'N'.repeat(61) }, '23514'],
    ['refuses an untrimmed name', { name: '\u00a0Intake' }, '23514'],
    ['refuses a name with a tab', { name: 'In\ttake' }, '23514'],
    ['refuses position 0', { position: 0 }, '23514'],
    ["refuses another tenant's round", { round_id: '<strangers round>' }, '23503'],
    ['refuses a creator from another tenant', { created_by: '<stranger>' }, '23503'],
  ])('%s', async (_, change: Row, expected) => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const statement = insertStatement(
        client,
        'grants.stage',
        stageRow(tenant, round, { name: 'Checked', position: 8, ...resolved(change) }),
      );
      expect(await outcome(client, statement.text, statement.values)).toBe(expected);
    });
  });
});

describe('grants.rubric_criterion', { timeout: 30_000 }, () => {
  it("keeps each tenant's criteria from every other tenant", async () => {
    await expectCrossTenantDenial('grants.rubric_criterion', async (client, owner) =>
      criterionRow(owner, await addStage(client, owner)),
    );
  });

  it('lets app_api add, change, reorder and delete criteria, and keeps a stage that has any', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const stage = await addStage(client, tenant, round, { name: 'Review', position: 2 });
      const first = await addCriterion(client, tenant, stage, { created_by: member });
      const second = await addCriterion(client, tenant, stage, { label: 'Reach', position: 2 });
      const added = await client.query(
        'SELECT guidance, scale_min, scale_max FROM grants.rubric_criterion WHERE id = $1',
        [first],
      );
      expect(added.rows).toEqual([{ guidance: '', scale_min: 1, scale_max: 5 }]);

      await client.query(
        `UPDATE grants.rubric_criterion
            SET position = CASE id WHEN $1 THEN 2 ELSE 1 END, label = label || ' (revised)',
                guidance = 'Score 0 to 10.', weight = 3, scale_min = 0, scale_max = 10,
                updated_by = $3
          WHERE id IN ($1, $2)`,
        [first, second, member],
      );
      expect(await checkNow(client)).toBe('ok');

      for (const change of ['stage_id = stage_id', 'tenant_id = tenant_id', 'id = id']) {
        expect(await outcome(client, `UPDATE grants.rubric_criterion SET ${change}`), change).toBe(
          '42501',
        );
      }

      const deleteStage = 'DELETE FROM grants.stage WHERE id = $1';
      expect(await outcome(client, deleteStage, [stage])).toBe('23503');
      const removed = await client.query(
        'DELETE FROM grants.rubric_criterion WHERE stage_id = $1',
        [stage],
      );
      expect(removed.rowCount).toBe(2);
      expect(await outcome(client, deleteStage, [stage])).toBe('ok');
    });
  });

  it('refuses at commit a position that another criterion of the stage has', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const stage = await addStage(client, tenant, round, { name: 'Panel', position: 3 });
      await addCriterion(client, tenant, stage);
      await addCriterion(client, tenant, stage);
      expect(await checkNow(client)).toBe('23505');
    });
  });

  it.each([
    ['accepts the widest scale', { scale_min: 0, scale_max: 10 }, 'ok'],
    ['accepts guidance in paragraphs', { guidance: 'Look for:\n\nneed and reach.' }, 'ok'],
    ['refuses an empty label', { label: '' }, '23514'],
    ['refuses a label over 100 characters', { label: 'L'.repeat(101) }, '23514'],
    ['refuses guidance over 1000 characters', { guidance: 'G'.repeat(1001) }, '23514'],
    ['refuses guidance starting with a line break', { guidance: '\nLook' }, '23514'],
    ['refuses a weight of 0', { weight: 0 }, '23514'],
    ['refuses a weight over 100', { weight: 101 }, '23514'],
    ['refuses a scale minimum below 0', { scale_min: -1 }, '23514'],
    ['refuses a scale maximum over 10', { scale_max: 11 }, '23514'],
    ['refuses a minimum at the maximum', { scale_min: 5, scale_max: 5 }, '23514'],
    ['refuses a minimum above the maximum', { scale_min: 6, scale_max: 5 }, '23514'],
    ['refuses position 0', { position: 0 }, '23514'],
    ["refuses another tenant's stage", { stage_id: '<strangers stage>' }, '23503'],
    ['refuses an updater from another tenant', { updated_by: '<stranger>' }, '23503'],
  ])('%s', async (_, change: Row, expected) => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const stage = await addStage(client, tenant, round, { name: 'Scored', position: 7 });
      const statement = insertStatement(
        client,
        'grants.rubric_criterion',
        criterionRow(tenant, stage, resolved(change)),
      );
      expect(await outcome(client, statement.text, statement.values)).toBe(expected);
    });
  });
});
