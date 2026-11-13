// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Saved views through the whole API against the test database, as app_api,
// for two tenants: who may change and delete a view, that only keys are
// stored, that every read goes through the viewer's projection, and that the
// audit log names the changed paths and never a name or a filter value.

import { randomUUID } from 'node:crypto';

import { createDatabase, withTenant } from '@pixel-scientists/db';
import type { SavedView } from '@pixel-scientists/grants/contracts';
import { resolveViewForViewer, type ResolvedView } from '@pixel-scientists/grants/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { trustedTenantId } from '../../../packages/db/src/tenant-context.ts';
import { databaseSettings } from '../../../packages/db/test/connect.ts';
import { startMessagesApi, type MessagesApi } from './messages-api.ts';
import { switchModule } from './modules-on.ts';
import { answer } from './programme-api.ts';
import { question } from './forms-api.ts';
import { reviewFields } from './assessment-api.ts';
import type { Member } from './settings-api.ts';
import { expectLooksMissing } from './support.ts';

vi.setConfig({ testTimeout: 30_000 });

let t: MessagesApi;
const settings = databaseSettings('app_api', 2);
const api = createDatabase<unknown>({
  host: settings.host,
  port: settings.port,
  database: settings.database,
  password: settings.password,
  role: 'app_api',
  maxConnections: 2,
  applicationName: 'tps-db-tests',
});

/** Never to be read by anyone but staff: a special category answer, aggregate only. */
const ethnicity = question('f_ethnic', 'short_text', 'Ethnic group', {
  audiences: 'aggregate_only',
  classification: 'special_category',
});

beforeAll(async () => {
  t = await startMessagesApi('41131');
  await t.reviewRound({ fields: [...reviewFields, ethnicity] });
}, 60_000);

afterAll(async () => {
  await t.close();
  await api.destroy();
});

const VIEW_NAME = 'Synthetic view: late applications from small charities';
const body = (change: object = {}) => ({
  name: VIEW_NAME,
  filter: { status: 'submitted', late: true },
  sort: { by: 'submittedAt', direction: 'desc' },
  columns: [
    { kind: 'column', id: 'organisation' },
    { kind: 'column', id: 'owner' },
    { kind: 'column', id: 'labels' },
    { kind: 'answer', fieldId: 'f_summary' },
    { kind: 'answer', fieldId: 'f_internal' },
    { kind: 'answer', fieldId: 'f_contact' },
    { kind: 'answer', fieldId: 'f_ethnic' },
    { kind: 'answer', fieldId: 'f_nothere' },
  ],
  ...change,
});

const create = (change: object = {}, member: Member = t.managerA, key?: string) =>
  t.send(member, 'POST', '/console/saved-views', body(change), 'console', null, key);
const created = async (change: object = {}, member: Member = t.managerA) =>
  answer<SavedView>(create(change, member), 201);
const viewPath = (id: string) => `/console/saved-views/${id}`;

const stored = (id: string) =>
  t.rows<{ filter: object; sort: object; columns: string[]; created_by: string }>(
    'SELECT filter, sort, columns, created_by FROM grants.saved_view WHERE id = $1',
    [id],
  );

const events = (action: string, id: string) =>
  t.eventsOf<{ actor_id: string; changes: object }>(action, id);

/** The view as `resolveViewForViewer` gives it to a member of the audience, in tenant A. */
const resolvedFor = (id: string, audience: 'staff' | 'reviewer' | 'blind_reviewer') =>
  withTenant(api, trustedTenantId(t.tenantA.id), (tx) =>
    resolveViewForViewer(tx, { audience, permissions: new Set(['grants.applications.read']) }, id),
  ) as Promise<ResolvedView>;

describe('saving a view', () => {
  it('stores only keys, as the session’s member, and audits paths with no values', async () => {
    const view = await created();

    expect(view.createdBy.membershipId).toBe(t.managerA.membershipId);
    const [row] = await stored(view.id);
    expect(row).toMatchObject({
      filter: { status: 'submitted', late: true },
      sort: { by: 'submittedAt', direction: 'desc' },
      created_by: t.managerA.membershipId,
    });
    expect(row?.columns).toEqual([
      'organisation',
      'owner',
      'labels',
      'answer.f_summary',
      'answer.f_internal',
      'answer.f_contact',
      'answer.f_ethnic',
      'answer.f_nothere',
    ]);
    const [event] = await events('grants.saved_view.created', view.id);
    expect(event).toMatchObject({ actor_id: t.managerA.membershipId });
    expect(JSON.stringify(event?.changes)).not.toMatch(/Synthetic|late|submitted/);
    expect(Object.keys(event?.changes ?? {})).toEqual([
      'grants.saved_view.name',
      'grants.saved_view.filter',
      'grants.saved_view.sort',
      'grants.saved_view.columns',
    ]);
  });

  it('refuses a body that names a creator, a tenant, a list of ids or a path, and a bad filter', async () => {
    const refusals = await Promise.all(
      [
        { createdBy: t.ada.membershipId },
        { tenantId: t.tenantB.id },
        { submissionIds: [randomUUID()] },
        { filter: { answers: { f_title: 'x' } } },
        { filter: { score: 3 } },
        { columns: [{ kind: 'answer', fieldId: 'answers.f_title' }] },
        {
          columns: [
            { kind: 'column', id: 'organisation' },
            { kind: 'column', id: 'organisation' },
          ],
        },
        { columns: [] },
        { name: '   ' },
      ].map((change) => create(change)),
    );

    expect(refusals.map((response) => response.statusCode)).toEqual(Array(9).fill(400));
  });

  it('makes one view for one idempotency key', async () => {
    const key = randomUUID();
    const first = await answer<SavedView>(create({}, t.managerA, key), 201);
    const again = await answer<SavedView>(create({}, t.managerA, key), 201);

    expect(again.id).toBe(first.id);
    expect(await events('grants.saved_view.created', first.id)).toHaveLength(1);
  });

  it('lets everyone who reads applications list and read it, and no one else', async () => {
    const view = await created();

    const listed = await answer<{ views: SavedView[] }>(
      t.send(t.ada, 'GET', '/console/saved-views'),
    );
    expect(listed.views.find((item) => item.id === view.id)?.createdBy).toMatchObject({
      membershipId: t.managerA.membershipId,
    });
    expect((await answer<SavedView>(t.send(t.ada, 'GET', viewPath(view.id)))).id).toBe(view.id);
    for (const member of [t.grace, t.adminA]) {
      expect((await t.send(member, 'GET', '/console/saved-views')).statusCode).toBe(403);
      expect((await t.send(member, 'GET', viewPath(view.id))).statusCode).toBe(403);
      expect((await create({}, member)).statusCode).toBe(403);
    }
    expect((await t.send(undefined, 'GET', viewPath(view.id))).statusCode).toBe(401);
  });
});

describe('what a viewer is given back', () => {
  it('leaves out answer columns the staff projection hides, and special category ones, by id', async () => {
    const view = await created();

    const read = await answer<SavedView>(t.send(t.ada, 'GET', viewPath(view.id)));
    const asked = (id: string) => read.columns.some((c) => c.kind === 'answer' && c.fieldId === id);

    expect(read.columns.filter((c) => c.kind === 'column')).toHaveLength(3);
    expect(asked('f_summary')).toBe(true);
    expect(asked('f_internal')).toBe(true);
    for (const id of ['f_ethnic', 'f_nothere']) expect(asked(id)).toBe(false);
    expect((await resolvedFor(view.id, 'staff')).dropped).toEqual([
      'answer.f_ethnic',
      'answer.f_nothere',
    ]);
  });

  it('gives a reviewer and a blind reviewer no more than their own projection', async () => {
    const view = await created({
      sort: { by: 'owner', direction: 'asc' },
      filter: { status: 'submitted', ownerId: t.ada.membershipId },
    });

    const reviewer = await resolvedFor(view.id, 'reviewer');
    expect(reviewer.dropped).toEqual([
      'owner',
      'labels',
      'answer.f_internal',
      'answer.f_ethnic',
      'answer.f_nothere',
      'filter.ownerId',
      'sort.owner',
    ]);
    expect(reviewer.filter).toEqual({ status: 'submitted' });
    expect(reviewer.sort).toEqual({ by: 'submittedAt', direction: 'desc' });

    const blind = await resolvedFor(view.id, 'blind_reviewer');
    expect(blind.dropped).toContain('organisation');
    expect(blind.dropped).toContain('answer.f_contact');
    expect(blind.columns).toEqual([{ kind: 'answer', fieldId: 'f_summary' }]);
    expect(JSON.stringify(blind.columns)).not.toMatch(/f_internal|f_ethnic|f_contact/);
  });

  it('refuses a stored value that no longer parses, and repairs nothing', async () => {
    const view = await created();
    await t.rows(`UPDATE grants.saved_view SET filter = '{"score": 3}'::jsonb WHERE id = $1`, [
      view.id,
    ]);

    expect(await resolvedFor(view.id, 'staff')).toEqual({ code: 'unusable' });
    const response = await t.send(t.managerA, 'GET', viewPath(view.id));
    expect(response.statusCode).toBe(409);
    expect(response.body).not.toContain('score');
    const listed = await answer<{ views: SavedView[] }>(
      t.send(t.managerA, 'GET', '/console/saved-views'),
    );
    expect(listed.views.map((item) => item.id)).not.toContain(view.id);
  });
});

describe('changing and deleting a view', () => {
  it('lets only the creator update it, and audits the changed paths', async () => {
    const view = await created();
    const change = { name: 'Synthetic renamed view', sort: { by: 'status', direction: 'asc' } };

    expect((await t.send(t.ada, 'PUT', viewPath(view.id), body(change))).statusCode).toBe(403);
    const updated = await answer<SavedView>(
      t.send(t.managerA, 'PUT', viewPath(view.id), body(change)),
    );
    expect(updated).toMatchObject({ name: change.name, sort: change.sort });

    await answer(t.send(t.managerA, 'PUT', viewPath(view.id), body(change)));
    const updates = await events('grants.saved_view.updated', view.id);
    expect(updates).toHaveLength(1);
    expect(Object.keys(updates[0]?.changes ?? {})).toEqual([
      'grants.saved_view.name',
      'grants.saved_view.sort',
    ]);
    expect(JSON.stringify(updates)).not.toContain('Synthetic');
  });

  it('compares what is stored in the database, so key order is no change and a new column is', async () => {
    const view = await created();
    const put = (change: object) =>
      answer(t.send(t.managerA, 'PUT', viewPath(view.id), body(change)));

    await put({ filter: { late: true, status: 'submitted' } });
    expect(await events('grants.saved_view.updated', view.id)).toHaveLength(0);

    await put({ columns: [{ kind: 'column', id: 'organisation' }] });
    const updates = await events('grants.saved_view.updated', view.id);
    expect(updates.map((event) => Object.keys(event.changes))).toEqual([
      ['grants.saved_view.columns'],
    ]);
  });

  it('lets the creator or a programme manager delete it, and no one else', async () => {
    const [mine, theirs] = [await created(), await created()];

    expect((await t.send(t.managerA, 'DELETE', viewPath(mine.id))).statusCode).toBe(204);
    expect((await t.send(t.ada, 'DELETE', viewPath(theirs.id))).statusCode).toBe(204);
    for (const id of [mine.id, theirs.id]) {
      expect(await stored(id)).toEqual([]);
      expect(await events('grants.saved_view.deleted', id)).toHaveLength(1);
    }
    expect((await t.send(t.managerA, 'DELETE', viewPath(mine.id))).statusCode).toBe(404);
  });

  it('answers another tenant’s caller as missing, and a module switched off as 404', async () => {
    const view = await created();
    const missing = await t.send(t.managerA, 'GET', viewPath(randomUUID()));

    for (const method of ['GET', 'PUT', 'DELETE'] as const) {
      const outside = await t.send(
        t.managerB,
        method,
        viewPath(view.id),
        method === 'PUT' ? body() : undefined,
      );
      expectLooksMissing(
        outside,
        await t.send(
          t.managerB,
          method,
          viewPath(randomUUID()),
          method === 'PUT' ? body() : undefined,
        ),
      );
    }
    expect(missing.statusCode).toBe(404);
    const listed = await answer<{ views: SavedView[] }>(
      t.send(t.managerB, 'GET', '/console/saved-views'),
    );
    expect(listed.views.map((item) => item.id)).not.toContain(view.id);

    await switchModule(t.tenantA, 'grants', false);
    try {
      expect((await t.send(t.managerA, 'GET', viewPath(view.id))).statusCode).toBe(404);
      expect((await create()).statusCode).toBe(404);
    } finally {
      await switchModule(t.tenantA, 'grants');
    }
    expect(await stored(view.id)).toHaveLength(1);
  });
});
