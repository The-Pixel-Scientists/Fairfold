// SPDX-License-Identifier: AGPL-3.0-or-later
//
// grants.conflict_declaration and grants.score (migration 0012): isolation,
// a declaration by the assigned reviewer on a conflicted assignment that
// never changes, scores keyed to the criteria of their assignment's own
// stage, their bounds, and scores that change only while the assignment is
// open.

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
import { addAssignment, scoreRow, type Review } from './assessment-fixtures.ts';

/** An open assignment of a tenant and its review, and another tenant's. */
let tenant: TestTenant;
let assignment: string;
let review: Review;
let strangers: { id: string; review: Review };
beforeAll(async () => {
  tenant = await createTestTenant();
  const other = await createTestTenant();
  ({ id: assignment, review } = await asMigratorIn(tenant.id, (client) =>
    addAssignment(client, tenant),
  ));
  strangers = await asMigratorIn(other.id, (client) => addAssignment(client, other));
}, 60_000);

const conflicted = "UPDATE grants.assignment SET status = 'conflicted' WHERE id = $1";

function declarationRow(owner: TestTenant, id: string, by: string, change: Row = {}): Row {
  return { tenant_id: owner.id, assignment_id: id, declared_by: by, ...change };
}

describe('grants.conflict_declaration', { timeout: 30_000 }, () => {
  it("keeps each tenant's declarations from every other tenant", async () => {
    await expectCrossTenantDenial('grants.conflict_declaration', async (client, owner) => {
      const { id, review: own } = await addAssignment(client, owner);
      await client.query(conflicted, [id]);
      return declarationRow(owner, id, own.reviewer);
    });
  });

  it.each([
    ['records a conflict on a conflicted assignment', {}, true, 'ok'],
    ['refuses one on an open assignment', {}, false, '55000'],
    ['refuses a declarer other than the reviewer', { declared_by: '<member>' }, true, '23503'],
    ["refuses another tenant's assignment", { assignment_id: '<strangers>' }, true, '23503'],
    ['refuses a time from the caller', { declared_at: '2000-01-01' }, true, '42501'],
  ])('%s', async (_, change: Row, mark, expected) => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      if (mark) await client.query(conflicted, [assignment]);
      const ids: Readonly<Record<string, string>> = {
        '<member>': review.parts.member,
        '<strangers>': strangers.id,
      };
      const values = Object.fromEntries(
        Object.entries(change).map(([column, value]) => [
          column,
          typeof value === 'string' ? (ids[value] ?? value) : value,
        ]),
      );
      const statement = insertStatement(
        client,
        'grants.conflict_declaration',
        declarationRow(tenant, assignment, review.reviewer, values),
      );
      expect(await outcome(client, statement.text, statement.values)).toBe(expected);
    });
  });

  it('records one declaration per assignment, which never changes or goes away', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      await client.query(conflicted, [assignment]);
      const row = declarationRow(tenant, assignment, review.reviewer);
      const id = await insertRow(client, 'grants.conflict_declaration', row);
      const again = insertStatement(client, 'grants.conflict_declaration', row);
      expect(await outcome(client, again.text, again.values)).toBe('23505');
      for (const statement of [
        'UPDATE grants.conflict_declaration SET declared_by = declared_by WHERE id = $1',
        'UPDATE grants.conflict_declaration SET declared_at = now() WHERE id = $1',
        'DELETE FROM grants.conflict_declaration WHERE id = $1',
      ]) {
        expect(await outcome(client, statement, [id]), statement).toBe('42501');
      }
    });
  });
});

describe('grants.score', { timeout: 30_000 }, () => {
  it("keeps each tenant's scores from every other tenant", async () => {
    await expectCrossTenantDenial('grants.score', async (client, owner) => {
      const { id, review: own } = await addAssignment(client, owner);
      return scoreRow(owner, own, id);
    });
  });

  it.each([
    ['scores a criterion of the assignment stage', {}, 'ok'],
    ['scores 0 and leaves no comment', { score: 0, comment: '' }, 'ok'],
    ['refuses a criterion of another stage', { criterion_id: '<intake>' }, '23503'],
    [
      'refuses a criterion of another stage, named as its own',
      { criterion_id: '<intake>', stage_id: '<intake stage>' },
      '23503',
    ],
    ["refuses another tenant's criterion", { criterion_id: '<strangers>' }, '23503'],
    ["refuses another tenant's assignment", { assignment_id: '<strangers assignment>' }, '23503'],
    ['refuses a score above 10', { score: 11 }, '23514'],
    ['refuses a score below 0', { score: -1 }, '23514'],
    ['refuses a comment over 2,000 characters', { comment: 'a'.repeat(2001) }, '23514'],
    ['refuses a comment that hides text', { comment: 'Strong\u202e case' }, '23514'],
    ['refuses a comment that starts with a space', { comment: ' Strong case' }, '23514'],
    ['refuses a comment of null', { comment: null }, '23502'],
  ])('%s', async (_, change: Row, expected) => {
    const ids: Readonly<Record<string, string>> = {
      '<intake>': review.criteria[2],
      '<intake stage>': review.parts.stages[0],
      '<strangers>': strangers.review.criteria[0],
      '<strangers assignment>': strangers.id,
    };
    const values = Object.fromEntries(
      Object.entries(change).map(([column, value]) => [
        column,
        typeof value === 'string' ? (ids[value] ?? value) : value,
      ]),
    );
    await asRoleIn('app_api', tenant.id, async (client) => {
      const statement = insertStatement(
        client,
        'grants.score',
        scoreRow(tenant, review, assignment, values),
      );
      expect(await outcome(client, statement.text, statement.values)).toBe(expected);
    });
  });

  it('scores each criterion once, and fixes what a score refers to', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const id = await insertRow(client, 'grants.score', scoreRow(tenant, review, assignment));
      const again = insertStatement(client, 'grants.score', scoreRow(tenant, review, assignment));
      expect(await outcome(client, again.text, again.values)).toBe('23505');
      for (const change of [
        'assignment_id = assignment_id',
        'stage_id = stage_id',
        'criterion_id = criterion_id',
        'tenant_id = tenant_id',
        'created_at = created_at',
      ]) {
        const update = `UPDATE grants.score SET ${change} WHERE id = $1`;
        expect(await outcome(client, update, [id]), change).toBe('42501');
      }
    });
  });

  it.each(['submitted', 'conflicted'])(
    'changes scores while the assignment is open, and never once it is %s',
    async (status) => {
      await asRoleIn('app_api', tenant.id, async (client) => {
        const id = await insertRow(client, 'grants.score', scoreRow(tenant, review, assignment));
        const second = scoreRow(tenant, review, assignment, { criterion_id: review.criteria[1] });
        const change = "UPDATE grants.score SET score = 5, comment = 'Changed' WHERE id = $1";
        const remove = 'DELETE FROM grants.score WHERE id = $1';
        expect(await outcome(client, change, [id])).toBe('ok');
        const removed = await insertRow(client, 'grants.score', second);
        expect(await client.query(remove, [removed])).toMatchObject({ rowCount: 1 });

        await client.query('UPDATE grants.assignment SET status = $2 WHERE id = $1', [
          assignment,
          status,
        ]);
        const add = insertStatement(client, 'grants.score', second);
        expect(await outcome(client, add.text, add.values)).toBe('55000');
        expect(await outcome(client, change, [id])).toBe('55000');
        expect(await outcome(client, remove, [id])).toBe('55000');
      });
    },
  );

  it('keeps a submitted score from migrator too', async () => {
    await asRoleIn('migrator', tenant.id, async (client) => {
      const id = await insertRow(client, 'grants.score', scoreRow(tenant, review, assignment));
      await client.query("UPDATE grants.assignment SET status = 'submitted' WHERE id = $1", [
        assignment,
      ]);
      const change = 'UPDATE grants.score SET score = 1 WHERE id = $1';
      expect(await outcome(client, change, [id])).toBe('55000');
    });
  });
});
