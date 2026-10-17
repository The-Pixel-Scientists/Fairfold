// SPDX-License-Identifier: AGPL-3.0-or-later
//
// grants.reviewer and grants.assignment (migration 0012): isolation, keys
// that keep an assignment to its round's pool, applications and stages,
// one assignment per application, reviewer and stage, the submission time
// the database sets, and the changes each status allows.

import { beforeAll, describe, expect, it } from 'vitest';

import { expectCrossTenantDenial } from '../cross-tenant.ts';
import { addOrganisation } from '../party/fixtures.ts';
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
import { addApplication, applicationRow, submit } from './application-fixtures.ts';
import {
  addAssignment,
  addReview,
  assignmentRow,
  reviewerRow,
  scoreRow,
  type Review,
} from './assessment-fixtures.ts';

/** A tenant's review, a second review in another round, and another tenant's. */
let tenant: TestTenant;
let review: Review;
let otherRound: Review;
let strangers: Review;
/** A member of the tenant in no pool, and a second submission of the review's round. */
let outsider: string;
let sameRound: string;
beforeAll(async () => {
  tenant = await createTestTenant();
  const other = await createTestTenant();
  review = await asMigratorIn(tenant.id, (client) => addReview(client, tenant));
  otherRound = await asMigratorIn(tenant.id, (client) => addReview(client, tenant));
  strangers = await asMigratorIn(other.id, (client) => addReview(client, other));
  [outsider, sameRound] = await asMigratorIn(tenant.id, async (client) => {
    const member = await addMember(client, tenant, ['reviewer']);
    const organisation = await addOrganisation(client, tenant);
    const row = applicationRow(tenant, review.parts, { organisation_id: organisation });
    const id = await insertRow(client, 'grants.application', row);
    await submit(client, id, review.parts.stages[1]);
    return [member, id];
  });
}, 60_000);

describe('grants.reviewer', { timeout: 30_000 }, () => {
  it("keeps each tenant's reviewer pools from every other tenant", async () => {
    await expectCrossTenantDenial('grants.reviewer', async (client, owner) => {
      const { parts } = await addApplication(client, owner);
      return reviewerRow(owner, parts.round, await addMember(client, owner), parts.member);
    });
  });

  it.each([
    ['adds a member to a pool', {}, 'ok'],
    ['refuses a member already in the pool', { membership_id: '<reviewer>' }, '23505'],
    ["refuses another tenant's member", { membership_id: '<stranger>' }, '23503'],
    ["refuses another tenant's round", { round_id: '<strangers round>' }, '23503'],
    ['refuses an adder from another tenant', { added_by: '<stranger>' }, '23503'],
    ['refuses a time from the caller', { added_at: '2000-01-01' }, '42501'],
  ])('%s', async (_, change: Row, expected) => {
    const ids: Readonly<Record<string, string>> = {
      '<reviewer>': review.reviewer,
      '<stranger>': strangers.reviewer,
      '<strangers round>': strangers.parts.round,
    };
    const values = Object.fromEntries(
      Object.entries(change).map(([column, value]) => [
        column,
        typeof value === 'string' ? (ids[value] ?? value) : value,
      ]),
    );
    await asRoleIn('app_api', tenant.id, async (client) => {
      const row = reviewerRow(tenant, review.parts.round, outsider, review.parts.member);
      const statement = insertStatement(client, 'grants.reviewer', { ...row, ...values });
      expect(await outcome(client, statement.text, statement.values)).toBe(expected);
    });
  });

  it('never changes a pool member, and removes one only while they have no assignment', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const remove = 'DELETE FROM grants.reviewer WHERE membership_id = $1 AND round_id = $2';
      const pooled = [review.reviewer, review.parts.round];
      expect(
        await outcome(client, 'UPDATE grants.reviewer SET added_by = added_by WHERE true'),
      ).toBe('42501');
      await insertRow(client, 'grants.assignment', assignmentRow(tenant, review));
      expect(await outcome(client, remove, pooled)).toBe('23503');
      await client.query('DELETE FROM grants.assignment WHERE reviewer_membership_id = $1', [
        review.reviewer,
      ]);
      expect(await outcome(client, remove, pooled)).toBe('ok');
    });
  });
});

describe('grants.assignment', { timeout: 30_000 }, () => {
  it("keeps each tenant's assignments from every other tenant", async () => {
    await expectCrossTenantDenial('grants.assignment', async (client, owner) =>
      assignmentRow(owner, await addReview(client, owner)),
    );
  });

  it.each([
    ['assigns a pool reviewer to a submission of the round', {}, 'ok'],
    ['assigns another submission of the same round', { application_id: '<same round>' }, 'ok'],
    ['refuses a reviewer not in the pool', { reviewer_membership_id: '<outsider>' }, '23503'],
    [
      "refuses a reviewer from another round's pool",
      { reviewer_membership_id: '<other pool>' },
      '23503',
    ],
    ['refuses an application of another round', { application_id: '<other app>' }, '23503'],
    ['refuses a stage of another round', { stage_id: '<other stage>' }, '23503'],
    ["refuses another tenant's application", { application_id: '<strangers app>' }, '23503'],
    ["refuses another tenant's reviewer", { reviewer_membership_id: '<stranger>' }, '23503'],
    ['refuses a creator from another tenant', { created_by: '<stranger>' }, '23503'],
    ['refuses a new submitted assignment', { status: 'submitted' }, '42501'],
    ['refuses a submission time from the caller', { submitted_at: '2000-01-01' }, '42501'],
  ])('%s', async (_, change: Row, expected) => {
    const ids: Readonly<Record<string, string>> = {
      '<same round>': sameRound,
      '<outsider>': outsider,
      '<other pool>': otherRound.reviewer,
      '<other app>': otherRound.application,
      '<other stage>': otherRound.parts.stages[1],
      '<strangers app>': strangers.application,
      '<stranger>': strangers.reviewer,
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
        'grants.assignment',
        assignmentRow(tenant, review, values),
      );
      expect(await outcome(client, statement.text, statement.values)).toBe(expected);
    });
  });

  it('assigns a reviewer once per application and stage', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      await insertRow(client, 'grants.assignment', assignmentRow(tenant, review));
      const again = insertStatement(client, 'grants.assignment', assignmentRow(tenant, review));
      expect(await outcome(client, again.text, again.values)).toBe('23505');
      const atIntake = insertStatement(
        client,
        'grants.assignment',
        assignmentRow(tenant, review, { stage_id: review.parts.stages[0] }),
      );
      expect(await outcome(client, atIntake.text, atIntake.values)).toBe('ok');
    });
  });

  it('starts assigned, and fixes what it refers to', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const id = await insertRow(client, 'grants.assignment', assignmentRow(tenant, review));
      const { rows } = await client.query(
        'SELECT status, submitted_at FROM grants.assignment WHERE id = $1',
        [id],
      );
      expect(rows).toEqual([{ status: 'assigned', submitted_at: null }]);
      for (const change of [
        'round_id = round_id',
        'application_id = application_id',
        'reviewer_membership_id = reviewer_membership_id',
        'stage_id = stage_id',
        'submitted_at = now()',
        'tenant_id = tenant_id',
        'created_at = created_at',
      ]) {
        const update = `UPDATE grants.assignment SET ${change} WHERE id = $1`;
        expect(await outcome(client, update, [id]), change).toBe('42501');
      }
      const unknown = "UPDATE grants.assignment SET status = 'scored' WHERE id = $1";
      expect(await outcome(client, unknown, [id])).toBe('23514');
    });
  });

  it('sets the submission time itself, whatever the caller sends', async () => {
    for (const [role, sent] of [
      ['app_api', ''],
      ['migrator', ", submitted_at = '2000-01-01'"],
    ] as const) {
      await asRoleIn(role, tenant.id, async (client) => {
        const id = await insertRow(client, 'grants.assignment', assignmentRow(tenant, review));
        await client.query(
          `UPDATE grants.assignment SET status = 'submitted'${sent} WHERE id = $1`,
          [id],
        );
        const { rows } = await client.query(
          'SELECT submitted_at = now() AS now FROM grants.assignment WHERE id = $1',
          [id],
        );
        expect(rows, role).toEqual([{ now: true }]);
      });
    }
  });

  it('refuses a submission time on an open assignment, even to migrator', async () => {
    await asRoleIn('migrator', tenant.id, async (client) => {
      const id = await insertRow(client, 'grants.assignment', assignmentRow(tenant, review));
      const update = 'UPDATE grants.assignment SET submitted_at = now() WHERE id = $1';
      expect(await outcome(client, update, [id])).toBe('23514');
    });
  });

  it.each(['submitted', 'conflicted'])(
    'never changes or removes a %s assignment',
    async (status) => {
      await asRoleIn('app_api', tenant.id, async (client) => {
        const id = await insertRow(client, 'grants.assignment', assignmentRow(tenant, review));
        await client.query('UPDATE grants.assignment SET status = $2 WHERE id = $1', [id, status]);
        for (const set of ["status = 'assigned'", "status = 'conflicted'", 'updated_by = NULL']) {
          const update = `UPDATE grants.assignment SET ${set} WHERE id = $1`;
          expect(await outcome(client, update, [id]), set).toBe('55000');
        }
        const remove = 'DELETE FROM grants.assignment WHERE id = $1';
        expect(await outcome(client, remove, [id])).toBe('55000');
      });
    },
  );

  it('removes an open assignment only while it has no score', async () => {
    const { id, review: own } = await asMigratorIn(tenant.id, (client) =>
      addAssignment(client, tenant),
    );
    await asRoleIn('app_api', tenant.id, async (client) => {
      const remove = 'DELETE FROM grants.assignment WHERE id = $1';
      const score = await insertRow(client, 'grants.score', scoreRow(tenant, own, id));
      expect(await outcome(client, remove, [id])).toBe('23503');
      await client.query('DELETE FROM grants.score WHERE id = $1', [score]);
      expect(await outcome(client, remove, [id])).toBe('ok');
    });
  });
});
