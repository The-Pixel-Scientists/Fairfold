// SPDX-License-Identifier: AGPL-3.0-or-later
//
// grants.eligibility_result and grants.stage_transition (migration 0011):
// isolation, keys that keep each row to its application's form version and
// round, their checks, and rows that app_api can add and read but never
// change or remove.

import { fieldIdSchema } from '@pixel-scientists/domain/forms';
import { beforeAll, describe, expect, it } from 'vitest';

import { expectCrossTenantDenial } from '../cross-tenant.ts';
import {
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  insertStatement,
  outcome,
  type Row,
  type TestTenant,
} from '../tenants.ts';
import { addApplication, addParts, type Parts } from './application-fixtures.ts';
import { addStage } from './fixtures.ts';

function checkRow(tenant: TestTenant, application: string, parts: Parts, change: Row = {}): Row {
  return {
    tenant_id: tenant.id,
    application_id: application,
    form_version_id: parts.formVersion,
    outcome: 'eligible',
    checked_by: parts.member,
    ...change,
  };
}

function moveRow(tenant: TestTenant, application: string, parts: Parts, change: Row = {}): Row {
  return {
    tenant_id: tenant.id,
    round_id: parts.round,
    application_id: application,
    to_stage_id: parts.stages[0],
    moved_by: parts.member,
    ...change,
  };
}

/** A tenant's draft and its parts, another draft, and another tenant's parts. */
let tenant: TestTenant;
let application: string;
let parts: Parts;
let other: { id: string; parts: Parts };
let strangers: Parts;
let otherRoundStage: string;
beforeAll(async () => {
  tenant = await createTestTenant();
  const stranger = await createTestTenant();
  ({ id: application, parts } = await asMigratorIn(tenant.id, (client) =>
    addApplication(client, tenant),
  ));
  other = await asMigratorIn(tenant.id, (client) => addApplication(client, tenant));
  otherRoundStage = await asMigratorIn(tenant.id, (client) => addStage(client, tenant));
  strangers = await asMigratorIn(stranger.id, (client) => addParts(client, stranger));
}, 60_000);

/** Insert `row` into `table` as app_api: its SQLSTATE, or ok. */
function tryInsert(table: string, row: Row): Promise<string> {
  return asRoleIn('app_api', tenant.id, async (client) => {
    const statement = insertStatement(client, table, row);
    return outcome(client, statement.text, statement.values);
  });
}

/** Add a row as app_api, then try to change and remove it: each SQLSTATE. */
function changeAndRemove(table: string, row: Row, set: string): Promise<string[]> {
  return asRoleIn('app_api', tenant.id, async (client) => {
    const id = await insertRow(client, table, row);
    return [
      await outcome(client, `UPDATE ${table} SET ${set} WHERE id = $1`, [id]),
      await outcome(client, `DELETE FROM ${table} WHERE id = $1`, [id]),
    ];
  });
}

describe('grants.eligibility_result', { timeout: 30_000 }, () => {
  it("keeps each tenant's eligibility checks from every other tenant", async () => {
    await expectCrossTenantDenial('grants.eligibility_result', async (client, owner) => {
      const { id, parts: own } = await addApplication(client, owner);
      return checkRow(owner, id, own);
    });
  });

  it('can be added and read, but never changed or removed', async () => {
    expect(
      await changeAndRemove(
        'grants.eligibility_result',
        checkRow(tenant, application, parts),
        "outcome = 'eligible'",
      ),
    ).toEqual(['42501', '42501']);
  });

  it.each([
    ['accepts an eligible check', {}, 'ok'],
    [
      'accepts a stopped check naming its field',
      { outcome: 'stopped', stopping_field_id: 'f_name' },
      'ok',
    ],
    ['refuses a stopped check without its field', { outcome: 'stopped' }, '23514'],
    ['refuses an eligible check naming a field', { stopping_field_id: 'f_name' }, '23514'],
    ['refuses an unknown outcome', { outcome: 'maybe' }, '23514'],
    [
      'refuses a field id in another format',
      { outcome: 'stopped', stopping_field_id: 'name' },
      '23514',
    ],
    ['refuses no checker', { checked_by: null }, '23502'],
    ['refuses a checker from another tenant', { checked_by: '<stranger>' }, '23503'],
    [
      'refuses a version the application does not pin',
      { form_version_id: '<other form>' },
      '23503',
    ],
    ['refuses a checking time from the caller', { checked_at: new Date() }, '42501'],
  ])('%s', async (_, change: Row, expected) => {
    const ids: Readonly<Record<string, string>> = {
      '<stranger>': strangers.member,
      '<other form>': other.parts.formVersion,
    };
    const values = Object.fromEntries(
      Object.entries(change).map(([column, value]) => [
        column,
        typeof value === 'string' ? (ids[value] ?? value) : value,
      ]),
    );
    expect(
      await tryInsert('grants.eligibility_result', checkRow(tenant, application, parts, values)),
    ).toBe(expected);
  });

  it('checks field ids in the format the form engine uses', async () => {
    for (const id of [
      'f_a',
      `f_${'a'.repeat(32)}`,
      'f_1x',
      'f_',
      `f_${'a'.repeat(33)}`,
      'F_a',
      'f-a',
    ]) {
      const row = checkRow(tenant, application, parts, {
        outcome: 'stopped',
        stopping_field_id: id,
      });
      const expected = fieldIdSchema.safeParse(id).success ? 'ok' : '23514';
      expect(await tryInsert('grants.eligibility_result', row), id).toBe(expected);
    }
  });
});

describe('grants.stage_transition', { timeout: 30_000 }, () => {
  it("keeps each tenant's stage moves from every other tenant", async () => {
    await expectCrossTenantDenial('grants.stage_transition', async (client, owner) => {
      const { id, parts: own } = await addApplication(client, owner);
      return moveRow(owner, id, own);
    });
  });

  it('can be added and read, but never changed or removed', async () => {
    expect(
      await changeAndRemove(
        'grants.stage_transition',
        moveRow(tenant, application, parts),
        'to_stage_id = to_stage_id',
      ),
    ).toEqual(['42501', '42501']);
  });

  it('starts from no stage once per application', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      await insertRow(client, 'grants.stage_transition', moveRow(tenant, application, parts));
      const again = insertStatement(
        client,
        'grants.stage_transition',
        moveRow(tenant, application, parts, { to_stage_id: parts.stages[1] }),
      );
      expect(await outcome(client, again.text, again.values)).toBe('23505');
      const next = moveRow(tenant, application, parts, {
        from_stage_id: parts.stages[0],
        to_stage_id: parts.stages[1],
      });
      expect(await insertRow(client, 'grants.stage_transition', next)).toBeTruthy();
    });
  });

  it.each([
    ['refuses a move to the same stage', { from_stage_id: '<stage>' }, '23514'],
    ['refuses a stage of another round', { to_stage_id: '<other round stage>' }, '23503'],
    ['refuses a first stage of another round', { from_stage_id: '<other round stage>' }, '23503'],
    ['refuses an application of another round', { application_id: '<other application>' }, '23503'],
    ["refuses another tenant's stage", { to_stage_id: '<strangers stage>' }, '23503'],
    ['refuses a mover from another tenant', { moved_by: '<stranger>' }, '23503'],
    ['refuses no mover', { moved_by: null }, '23502'],
    ['refuses a moving time from the caller', { moved_at: new Date() }, '42501'],
  ])('%s', async (_, change: Row, expected) => {
    const ids: Readonly<Record<string, string>> = {
      '<stage>': parts.stages[0],
      '<other round stage>': otherRoundStage,
      '<other application>': other.id,
      '<strangers stage>': strangers.stages[0],
      '<stranger>': strangers.member,
    };
    const values = Object.fromEntries(
      Object.entries(change).map(([column, value]) => [
        column,
        typeof value === 'string' ? (ids[value] ?? value) : value,
      ]),
    );
    expect(
      await tryInsert('grants.stage_transition', moveRow(tenant, application, parts, values)),
    ).toBe(expected);
  });
});
