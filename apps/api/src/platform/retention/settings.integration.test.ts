// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The retention settings routes through the whole API against the test
// database, as app_api, for two tenants: who may use them, the step-up
// window, the platform minimum, and the setting, configuration version and
// audit event a change leaves behind.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { asMigratorIn } from '../../../../../packages/db/test/tenants.ts';
import {
  answer,
  rowsOf,
  startProgrammeApi,
  storedVersions,
  type Problem,
  type ProgrammeApi,
} from '../../../test/programme-api.ts';
import { addMember, type Member } from '../../../test/settings-api.ts';

vi.setConfig({ testTimeout: 30_000 });

interface Policy {
  policyId: string;
  labelKey: string;
  days: number;
  minimumDays: number;
  defaultDays: number;
  changed: boolean;
}

const path = '/console/retention-policies';
const change = (policyId: string) => `${path}?policyId=${policyId}`;

let t: ProgrammeApi;
let adminB: Member;

beforeAll(async () => {
  t = await startProgrammeApi('41075');
  adminB = await addMember(t.tenantB, 'console', 'tenant_admin');
}, 60_000);

afterAll(async () => {
  await t.close();
});

const put = (member: Member, policyId: string, days: unknown, at: Date | null = new Date()) =>
  t.send(member, 'PUT', change(policyId), { days }, member.app, at);
const policiesOf = async (member: Member) =>
  (await answer<{ policies: Policy[] }>(t.send(member, 'GET', path))).policies;
const rowsFor = (member: Member) =>
  rowsOf<{ id: string; policy: string; days: number; created_by: string; updated_by: string }>(
    member.tenant,
    'SELECT id, policy, days, created_by, updated_by FROM app.retention_policy',
  );
const events = (member: Member) =>
  rowsOf<{ entity_id: string; actor_id: string; changes: Record<string, unknown> }>(
    member.tenant,
    `SELECT entity_id, actor_id, changes FROM app.audit_event
      WHERE action = 'platform.retention_policy.changed' ORDER BY occurred_at, id`,
  );

describe('who may use the retention routes', () => {
  it('refuses anyone without the retention permission, an applicant and a signed-out caller', async () => {
    for (const member of [t.managerA, t.reviewerA, t.applicantA]) {
      expect((await t.send(member, 'GET', path)).statusCode).toBe(403);
      expect((await put(member, 'audit', 400)).statusCode).toBe(403);
    }
    expect((await t.send(undefined, 'GET', path)).statusCode).toBe(401);
    expect(await rowsFor(t.adminA)).toEqual([]);
  });

  it('asks for a recent sign-in before a change, and writes nothing without one', async () => {
    expect((await put(t.adminA, 'audit', 400, null)).statusCode).toBe(403);
    const old = new Date(Date.now() - 6 * 60_000);
    expect((await put(t.adminA, 'audit', 400, old)).statusCode).toBe(403);
    expect(await rowsFor(t.adminA)).toEqual([]);
    expect((await t.send(t.adminA, 'GET', path)).statusCode).toBe(200);
  });
});

describe('reading the policies', () => {
  it('lists every policy the classification map names, at its platform minimum with no row', async () => {
    expect(await policiesOf(t.adminA)).toEqual([
      {
        policyId: 'audit',
        labelKey: 'audit',
        days: 365,
        minimumDays: 365,
        defaultDays: 365,
        changed: false,
      },
    ]);
  });
});

describe('changing a period', () => {
  it('answers 404 for an unknown policy and refuses a period under the minimum without echoing it', async () => {
    expect((await put(t.adminA, 'unknown_policy', 400)).statusCode).toBe(404);
    expect((await put(t.adminA, 'Not A Policy!', 400)).statusCode).toBe(400);

    const short = await put(t.adminA, 'audit', 364);
    expect(short.statusCode).toBe(400);
    const problem = short.json<Problem>();
    expect(problem.errors).toEqual([
      { field: 'body.days', message: expect.stringContaining('365') as string },
    ]);
    // The request id in the body is random and may contain any digits.
    expect(JSON.stringify({ detail: problem.detail, errors: problem.errors })).not.toContain('364');
    for (const days of [0, -1, 1.5, '400', 36_501, null]) {
      expect((await put(t.adminA, 'audit', days)).statusCode, String(days)).toBe(400);
    }
    const extra = await t.send(
      t.adminA,
      'PUT',
      change('audit'),
      { days: 400, tenantId: t.tenantB.id },
      'console',
      new Date(),
    );
    expect(extra.statusCode).toBe(400);
    expect(await rowsFor(t.adminA)).toEqual([]);
  });

  it('saves the period with a configuration version and an audit event', async () => {
    expect(await answer<Policy>(put(t.adminA, 'audit', 500))).toMatchObject({
      policyId: 'audit',
      days: 500,
      changed: true,
      minimumDays: 365,
    });

    const [row] = await rowsFor(t.adminA);
    expect(row).toMatchObject({
      policy: 'audit',
      days: 500,
      created_by: t.adminA.membershipId,
      updated_by: t.adminA.membershipId,
    });
    const [version] = await storedVersions(t.adminA.tenant, 'platform.retention', row?.id ?? '');
    expect(version).toMatchObject({
      version: 1,
      author_id: t.adminA.membershipId,
      diff: { changes: [{ field: 'days', from: 365, to: 500 }] },
    });
    const [event] = await events(t.adminA);
    expect(event).toMatchObject({
      entity_id: row?.id,
      actor_id: t.adminA.membershipId,
      changes: {
        'app.retention_policy.days': { before: 365, after: 500 },
        'app.retention_policy.policy': { after: 'audit' },
      },
    });
    expect((await policiesOf(t.adminA))[0]).toMatchObject({ days: 500, changed: true });
  });

  it('updates the same row on a later change, and writes nothing for the same value', async () => {
    const [before] = await rowsFor(t.adminA);
    const entity = before?.id ?? '';
    await answer<Policy>(put(t.adminA, 'audit', 500));
    expect(await storedVersions(t.adminA.tenant, 'platform.retention', entity)).toHaveLength(1);
    expect(await events(t.adminA)).toHaveLength(1);

    await answer<Policy>(put(t.adminA, 'audit', 730));
    const rows = await rowsFor(t.adminA);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: entity, days: 730 });
    const versions = await storedVersions(t.adminA.tenant, 'platform.retention', entity);
    expect(versions[1]?.diff.changes).toEqual([{ field: 'days', from: 500, to: 730 }]);
    expect(await events(t.adminA)).toHaveLength(2);
  });

  it('writes nothing for the minimum when the tenant has no row of its own', async () => {
    expect((await policiesOf(adminB))[0]).toMatchObject({ days: 365, changed: false });
    await answer<Policy>(put(adminB, 'audit', 365));
    expect(await rowsFor(adminB)).toEqual([]);
    expect(await events(adminB)).toEqual([]);
  });

  it('leaves the database check as the backstop under the minimum', async () => {
    await expect(
      asMigratorIn(t.tenantA.id, (client) =>
        client.query(
          `UPDATE app.retention_policy SET days = 100 WHERE tenant_id = $1 AND policy = 'audit'`,
          [t.tenantA.id],
        ),
      ),
    ).rejects.toThrow();
    expect((await rowsFor(t.adminA))[0]?.days).toBe(730);
  });
});

describe('between tenants', () => {
  it('keeps tenant A’s setting out of tenant B’s view and unchanged by B’s admin', async () => {
    const [mine] = await rowsFor(t.adminA);
    expect(mine?.days).toBe(730);
    expect((await policiesOf(adminB))[0]).toMatchObject({ days: 365, changed: false });

    await answer<Policy>(put(adminB, 'audit', 400));
    expect((await rowsFor(t.adminA))[0]).toMatchObject({ id: mine?.id, days: 730 });
    const [theirs] = await rowsFor(adminB);
    expect(theirs).toMatchObject({ days: 400, updated_by: adminB.membershipId });
    expect(theirs?.id).not.toBe(mine?.id);
    expect(await storedVersions(t.tenantA, 'platform.retention', theirs?.id ?? '')).toEqual([]);
    expect(await events(t.adminA)).toHaveLength(2);
    expect(await events(adminB)).toHaveLength(1);
  });
});
