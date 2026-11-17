// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Owners and labels on submissions through the whole API against the test
// database, as app_api, for two tenants: who may change them, what the tables
// and the audit log hold (ids only, never a label's name), that a bulk change
// is all or none, and that nothing here changes a status, stage or decision.

import { randomUUID } from 'node:crypto';

import { triageMessages, type AppliedLabels } from '@pixel-scientists/grants/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { asMigratorIn } from '../../../packages/db/test/tenants.ts';
import { startMessagesApi, type MessagesApi } from './messages-api.ts';
import { switchModule } from './modules-on.ts';
import { answer, type Problem } from './programme-api.ts';
import { addMember, type Member } from './settings-api.ts';
import { expectLooksMissing } from './support.ts';

vi.setConfig({ testTimeout: 30_000 });

let t: MessagesApi;

beforeAll(async () => {
  t = await startMessagesApi('41130');
}, 60_000);

afterAll(async () => {
  await t.close();
});

const ownerPath = (id: string) => `/console/submissions/${id}/owner`;
const labelsPath = (id: string) => `/console/submissions/${id}/labels`;
const setOwner = (id: string, ownerId: string | null, member: Member = t.managerA) =>
  t.send(member, 'PUT', ownerPath(id), { ownerId });
const setOwners = (submissionIds: string[], ownerId: string | null, member: Member = t.managerA) =>
  t.send(member, 'POST', '/console/submission-owners', { submissionIds, ownerId });
const labels = (id: string, change: object, member: Member = t.managerA) =>
  t.send(member, 'PATCH', labelsPath(id), change);
const labelsInBulk = (submissionIds: string[], change: object, member: Member = t.managerA) =>
  t.send(member, 'POST', '/console/submission-labels', { submissionIds, ...change });

const ownersOf = (ids: string[]) =>
  t.rows<{ application_id: string; membership_id: string; assigned_by: string }>(
    `SELECT application_id, membership_id, assigned_by FROM grants.application_owner
      WHERE application_id = ANY($1) ORDER BY application_id`,
    [ids],
  );

const labelsOn = async (id: string) =>
  (
    await t.rows<{ label_id: string }>(
      'SELECT label_id FROM grants.application_label WHERE application_id = $1 ORDER BY label_id',
      [id],
    )
  ).map((row) => row.label_id);

const LABEL_NAME = 'Synthetic label: needs a site visit';

async function aLabel(name = `${LABEL_NAME} ${randomUUID().slice(0, 4)}`, archived = false) {
  const [row] = await asMigratorIn(
    t.tenantA.id,
    async (client) =>
      (
        await client.query<{ id: string }>(
          `INSERT INTO grants.label (tenant_id, name, colour, archived, created_by, updated_by)
           VALUES ($1, $2, 'info', $3, $4, $4) RETURNING id`,
          [t.tenantA.id, name, archived, t.managerA.membershipId],
        )
      ).rows,
  );
  return { id: row?.id ?? '', name };
}

const eventsOf = (action: string, id: string) =>
  t.eventsOf<{ actor_id: string; subject_party_id: string | null; changes: object }>(action, id);

const stateOf = (id: string) =>
  t.rows<{ status: string; stage_id: string }>(
    'SELECT status, stage_id FROM grants.application WHERE id = $1',
    [id],
  );

describe('setting the owner', () => {
  it('writes the session’s member as assigner, names the owner, and audits ids only', async () => {
    const { id } = await t.submitted();
    const before = await stateOf(id);

    const set = await answer<{ owner: { membershipId: string; name: string | null } }>(
      setOwner(id, t.ada.membershipId),
    );

    expect(set.owner).toEqual({ membershipId: t.ada.membershipId, name: 'Ada Lovelace' });
    expect(await ownersOf([id])).toEqual([
      {
        application_id: id,
        membership_id: t.ada.membershipId,
        assigned_by: t.managerA.membershipId,
      },
    ]);
    const [event] = await eventsOf('grants.application.owner_changed', id);
    expect(event).toMatchObject({ actor_id: t.managerA.membershipId });
    expect(event?.subject_party_id).toEqual(expect.any(String));
    expect(event?.changes).toEqual({
      'grants.application_owner.membership_id': { before: null, after: t.ada.membershipId },
    });

    await answer(setOwner(id, t.ada.membershipId));
    expect(await eventsOf('grants.application.owner_changed', id)).toHaveLength(1);

    expect(await answer(setOwner(id, null))).toEqual({ owner: null });
    expect(await ownersOf([id])).toEqual([]);
    expect(await eventsOf('grants.application.owner_changed', id)).toHaveLength(2);
    expect(await stateOf(id)).toEqual(before);
  });

  it('refuses an owner who may not read applications, naming no one', async () => {
    const { id } = await t.submitted();
    const suspended = await addMember(t.tenantA, 'console', 'programme_manager');
    await asMigratorIn(t.tenantA.id, (client) =>
      client.query("UPDATE app.membership SET status = 'suspended' WHERE id = $1", [
        suspended.membershipId,
      ]),
    );
    const outside = [t.grace.membershipId, t.adminA.membershipId, t.managerB.membershipId];
    outside.push(suspended.membershipId, randomUUID());

    for (const ownerId of outside) {
      const response = await setOwner(id, ownerId);
      expect(response.statusCode, ownerId).toBe(400);
      expect(response.json<Problem>().errors).toEqual([
        { field: 'body.ownerId', message: triageMessages.ownerCannotView },
      ]);
      expect(response.body).not.toContain(ownerId);
    }
    expect((await setOwners([id], t.grace.membershipId)).statusCode).toBe(400);
    expect(await ownersOf([id])).toEqual([]);
  });

  it('is all or none in bulk: one missing, draft or other-tenant id changes nothing', async () => {
    const [a, b] = [await t.submitted(), await t.submitted()];
    const draft = await t.aDraft(t.ann, (await t.reviewRound()).open.round.id);

    expect((await setOwners([a.id, b.id, randomUUID()], t.ada.membershipId)).statusCode).toBe(404);
    expect((await setOwners([a.id, draft.id], t.ada.membershipId)).statusCode).toBe(404);
    expect((await setOwners([a.id, b.id], t.ada.membershipId, t.managerB)).statusCode).toBe(404);
    expect(await ownersOf([a.id, b.id])).toEqual([]);

    expect(await answer(setOwners([a.id, b.id], t.ada.membershipId))).toEqual({ changed: 2 });
    expect(await answer(setOwners([a.id, b.id], t.ada.membershipId))).toEqual({ changed: 0 });
    expect(await ownersOf([a.id, b.id])).toHaveLength(2);
    expect(await eventsOf('grants.application.owner_changed', a.id)).toHaveLength(1);
    expect(await answer(setOwners([a.id, b.id], t.managerA.membershipId))).toEqual({ changed: 2 });
    expect(await answer(setOwners([a.id, b.id], null))).toEqual({ changed: 2 });
    expect(await ownersOf([a.id, b.id])).toEqual([]);
  });

  it('refuses a body that names an actor, a tenant or an owner by email', async () => {
    const { id } = await t.submitted();
    const put = (body: object) => t.send(t.managerA, 'PUT', ownerPath(id), body);
    const bulk = (body: object) => t.send(t.managerA, 'POST', '/console/submission-owners', body);
    const refusals = await Promise.all([
      put({ ownerId: null, assignedBy: t.ada.membershipId }),
      put({ ownerId: null, tenantId: t.tenantB.id }),
      put({ ownerId: 'ada@example.org' }),
      put({}),
      bulk({ submissionIds: [], ownerId: null }),
      bulk({ submissionIds: [id, id], ownerId: null }),
    ]);

    expect(refusals.map((response) => response.statusCode)).toEqual([400, 400, 400, 400, 400, 400]);
    expect(await ownersOf([id])).toEqual([]);
  });

  it('refuses members without the permission, and answers other tenants and a module off as missing', async () => {
    const { id } = await t.submitted();
    for (const member of [t.grace, t.adminA]) {
      expect((await setOwner(id, null, member)).statusCode).toBe(403);
      expect((await setOwners([id], null, member)).statusCode).toBe(403);
    }
    const asApplicant = await t.send(t.ann, 'PUT', ownerPath(id), { ownerId: null }, 'console');
    expect(asApplicant.statusCode).not.toBe(200);
    expect((await t.send(undefined, 'PUT', ownerPath(id), { ownerId: null })).statusCode).toBe(401);

    expectLooksMissing(await setOwner(id, null, t.managerB), await setOwner(randomUUID(), null));

    await switchModule(t.tenantA, 'grants', false);
    try {
      expect((await setOwner(id, null)).statusCode).toBe(404);
      expect((await setOwners([id], null)).statusCode).toBe(404);
    } finally {
      await switchModule(t.tenantA, 'grants');
    }
  });
});

describe('labels on submissions', () => {
  it('adds and removes as sets and audits label ids, never names', async () => {
    const { id } = await t.submitted();
    const [one, two] = [await aLabel(), await aLabel()];

    const first = await answer<AppliedLabels>(labels(id, { add: [one.id, two.id] }));
    expect(first.labels.map((label) => label.id).sort()).toEqual([one.id, two.id].sort());

    const again = await answer<AppliedLabels>(labels(id, { add: [one.id], remove: [] }));
    expect(again.labels).toHaveLength(2);
    expect(await eventsOf('grants.application.labels_changed', id)).toHaveLength(1);

    await answer(labels(id, { remove: [one.id, (await aLabel()).id] }));
    expect(await labelsOn(id)).toEqual([two.id]);

    const events = await eventsOf('grants.application.labels_changed', id);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ actor_id: t.managerA.membershipId });
    expect(events[0]?.subject_party_id).toEqual(expect.any(String));
    expect(JSON.stringify(events.map((event) => event.changes))).not.toContain(LABEL_NAME);
    expect(events[1]?.changes).toEqual({
      'grants.application_label.label_id': { before: [one.id], after: [] },
    });
  });

  it('refuses an archived label before the insert, and lets one already on be removed', async () => {
    const [on, next] = [await t.submitted(), await t.submitted()];
    const live = await aLabel();
    const archived = await aLabel();
    await answer(labels(on.id, { add: [archived.id] }));
    await asMigratorIn(t.tenantA.id, (client) =>
      client.query('UPDATE grants.label SET archived = true WHERE id = $1', [archived.id]),
    );

    const refused = await labels(next.id, { add: [live.id, archived.id] });
    expect(refused.statusCode).toBe(409);
    expect(refused.json<Problem>().detail).toBe(triageMessages.labelArchived);
    expect(refused.body).not.toContain(archived.name);
    expect(await labelsOn(next.id)).toEqual([]);

    await answer(labels(on.id, { remove: [archived.id] }));
    expect(await labelsOn(on.id)).toEqual([]);
  });

  it('is all or none in bulk, and another tenant’s label or application is not found', async () => {
    const [a, b] = [await t.submitted(), await t.submitted()];
    const label = await aLabel();
    const [other] = await asMigratorIn(
      t.tenantB.id,
      async (client) =>
        (
          await client.query<{ id: string }>(
            `INSERT INTO grants.label (tenant_id, name, created_by, updated_by)
             VALUES ($1, 'Other tenant label', $2, $2) RETURNING id`,
            [t.tenantB.id, t.managerB.membershipId],
          )
        ).rows,
    );

    for (const change of [
      { submissionIds: [a.id, randomUUID()], add: [label.id] },
      { submissionIds: [a.id, b.id], add: [label.id, randomUUID()] },
      { submissionIds: [a.id, b.id], add: [label.id, other?.id] },
    ]) {
      const response = await t.send(t.managerA, 'POST', '/console/submission-labels', change);
      expect(response.statusCode).toBe(404);
    }
    expect((await labelsInBulk([a.id, b.id], { add: [label.id] }, t.managerB)).statusCode).toBe(
      404,
    );
    expect(await labelsOn(a.id)).toEqual([]);
    expect(await labelsOn(b.id)).toEqual([]);

    expect(await answer(labelsInBulk([a.id, b.id], { add: [label.id] }))).toEqual({ changed: 2 });
    expect(await answer(labelsInBulk([a.id, b.id], { add: [label.id] }))).toEqual({ changed: 0 });
    expect(await answer(labelsInBulk([a.id, b.id], { remove: [label.id] }))).toEqual({
      changed: 2,
    });
  });

  it('refuses an empty change, a label in both lists and members without the permission', async () => {
    const { id } = await t.submitted();
    const label = await aLabel();

    for (const change of [
      {},
      { add: [label.id], remove: [label.id] },
      { add: [label.id], by: 'x' },
    ]) {
      expect((await labels(id, change)).statusCode).toBe(400);
    }
    for (const member of [t.grace, t.adminA]) {
      expect((await labels(id, { add: [label.id] }, member)).statusCode).toBe(403);
      expect((await labelsInBulk([id], { add: [label.id] }, member)).statusCode).toBe(403);
    }
    expectLooksMissing(
      await labels(id, { add: [label.id] }, t.managerB),
      await labels(randomUUID(), { add: [label.id] }),
    );
    expect(await labelsOn(id)).toEqual([]);
  });

  it('lists the tenant’s labels for members who read applications, and no one else', async () => {
    const label = await aLabel();
    const { labels: listed } = await answer<AppliedLabels>(t.send(t.ada, 'GET', '/console/labels'));

    expect(listed.find((item) => item.id === label.id)).toMatchObject({
      name: label.name,
      archived: false,
    });
    expect((await t.send(t.grace, 'GET', '/console/labels')).statusCode).toBe(403);
    const other = await answer<AppliedLabels>(t.send(t.managerB, 'GET', '/console/labels'));
    expect(other.labels.map((item) => item.id)).not.toContain(label.id);
  });
});
