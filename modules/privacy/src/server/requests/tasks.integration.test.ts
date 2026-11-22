// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The request task routes' handlers against the test database, as app_api
// in a tenant's transaction: assignees must be active members of the
// caller's tenant, `completed_by` is the session's member, the title never
// reaches an audit event, and tenant B cannot reach tenant A's tasks.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addMember, asMigratorIn } from '../../../../../packages/db/test/tenants.ts';
import {
  addFixture,
  as,
  closeDatabase,
  handlers,
  openDatabase,
  refusal,
  unknownId,
  type Fixture,
} from '../harness.integration.test.ts';

const TITLE = 'Synthetic check of grants records';

const input = (change: Record<string, unknown> = {}) => ({
  title: TITLE,
  assigneeMembershipId: null,
  moduleId: null,
  dueOn: null,
  ...change,
});

let a: Fixture;
let b: Fixture;
let request: string;
/** Members of A who can no longer be given work: suspended and removed. */
let suspended: string;
let removed: string;

beforeAll(async () => {
  openDatabase();
  a = await addFixture();
  b = await addFixture();
  [suspended, removed] = (await asMigratorIn(a.tenant.id, async (client) => {
    const ids: string[] = [];
    for (const status of ['suspended', 'removed']) {
      const id = await addMember(client, a.tenant);
      await client.query('UPDATE app.membership SET status = $2 WHERE id = $1', [id, status]);
      ids.push(id);
    }
    return ids;
  })) as [string, string];
  ({
    result: { id: request },
  } = await as(a, a.member, (tx, context) =>
    handlers.createRightsRequest({
      tx,
      context,
      input: {
        body: {
          personId: a.person,
          receivedAt: '2026-11-02T10:00:00.000Z',
          kind: 'access',
          channel: 'email',
          summary: 'Synthetic request',
          identityCheck: 'not_started',
        },
      },
    }),
  ));
}, 60_000);

afterAll(closeDatabase);

const createTask = (fixture: Fixture, requestId: string, change: Record<string, unknown> = {}) =>
  as(fixture, fixture.member, (tx, context) =>
    handlers.createRequestTask({
      tx,
      context,
      input: { params: { requestId }, body: input(change) },
    }),
  );

describe('request tasks', () => {
  it('adds a task for an active member and a tool, audits it for the request’s person, and lists it', async () => {
    const { result, events } = await createTask(a, request, {
      assigneeMembershipId: a.second,
      moduleId: 'grants',
      dueOn: '2026-11-25',
    });

    expect(result).toMatchObject({
      requestId: request,
      title: TITLE,
      assigneeMembershipId: a.second,
      moduleId: 'grants',
      dueOn: '2026-11-25',
      completedAt: null,
    });
    expect(events).toEqual([
      {
        kind: 'record',
        action: 'privacy.request_task.created',
        entityId: result.id,
        subject: a.person,
        changes: {
          'privacy.request_task.assigned_to': { after: a.second },
          'privacy.request_task.module_id': { after: 'grants' },
          'privacy.request_task.due_on': { after: '2026-11-25' },
        },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain(TITLE);

    const { result: listed } = await as(a, a.member, (tx, context) =>
      handlers.listRequestTasks({ tx, context, input: { params: { requestId: request } } }),
    );
    expect(listed.tasks.map(({ id }) => id)).toContain(result.id);
  });

  it('refuses an assignee who is missing, in another tenant, suspended or removed, naming the field', async () => {
    const refused = [];
    for (const assignee of [b.member, unknownId(), suspended, removed]) {
      refused.push(await refusal(createTask(a, request, { assigneeMembershipId: assignee })));
    }

    for (const problem of refused) {
      expect(problem).toMatchObject({
        status: 400,
        message: 'Choose an active member of your team.',
        errors: [{ field: 'body.assigneeMembershipId' }],
      });
      expect(JSON.stringify([problem.message, problem.errors])).not.toMatch(
        new RegExp([b.member, suspended, removed].join('|')),
      );
    }
  });

  it('refuses to move a task to an inactive assignee, and does not recheck one who is unchanged', async () => {
    const leaver = await asMigratorIn(a.tenant.id, (client) => addMember(client, a.tenant));
    const { result: task } = await createTask(a, request, { assigneeMembershipId: leaver });
    await asMigratorIn(a.tenant.id, (client) =>
      client.query("UPDATE app.membership SET status = 'suspended' WHERE id = $1", [leaver]),
    );
    const update = (change: Record<string, unknown>) =>
      as(a, a.member, (tx, context) =>
        handlers.updateRequestTask({
          tx,
          context,
          input: {
            params: { requestId: request, taskId: task.id },
            body: input({ assigneeMembershipId: leaver, ...change }),
          },
        }),
      );

    expect(await refusal(update({ assigneeMembershipId: suspended }))).toMatchObject({
      status: 400,
      errors: [{ field: 'body.assigneeMembershipId' }],
    });
    const { result, events } = await update({ dueOn: '2026-11-30' });
    expect(result).toMatchObject({ assigneeMembershipId: leaver, dueOn: '2026-11-30' });
    expect(events[0]?.changes).toEqual({
      'privacy.request_task.due_on': { before: null, after: '2026-11-30' },
    });
  });

  it('changes and assigns a task, and completes it as the session’s member, once', async () => {
    const { result: task } = await createTask(a, request);
    const { result: changed, events: changes } = await as(a, a.member, (tx, context) =>
      handlers.updateRequestTask({
        tx,
        context,
        input: {
          params: { requestId: request, taskId: task.id },
          body: input({ title: 'Synthetic new title', assigneeMembershipId: a.member }),
        },
      }),
    );
    expect(changed).toMatchObject({ title: 'Synthetic new title', assigneeMembershipId: a.member });
    expect(changes).toEqual([
      {
        kind: 'record',
        action: 'privacy.request_task.updated',
        entityId: task.id,
        subject: a.person,
        changes: {
          'privacy.request_task.assigned_to': { before: null, after: a.member },
          'privacy.request_task.title': {},
        },
      },
    ]);
    expect(JSON.stringify(changes)).not.toContain('Synthetic new title');

    const done = await as(a, a.second, (tx, context) =>
      handlers.completeRequestTask({
        tx,
        context,
        input: { params: { requestId: request, taskId: task.id } },
      }),
    );
    expect(done.result.completedAt).not.toBeNull();
    expect(done.events).toEqual([
      {
        kind: 'record',
        action: 'privacy.request_task.completed',
        entityId: task.id,
        subject: a.person,
      },
    ]);

    const again = await as(a, a.member, (tx, context) =>
      handlers.completeRequestTask({
        tx,
        context,
        input: { params: { requestId: request, taskId: task.id } },
      }),
    );
    expect(again.events).toEqual([]);
    expect(again.result.completedAt).toBe(done.result.completedAt);
    const { rows } = await asMigratorIn(a.tenant.id, (client) =>
      client.query<{ completed_by: string }>(
        'SELECT completed_by FROM privacy.request_task WHERE id = $1',
        [task.id],
      ),
    );
    expect(rows[0]?.completed_by).toBe(a.second);
  });

  it('writes nothing when a task is saved unchanged', async () => {
    const { result: task } = await createTask(a, request, { dueOn: '2026-11-25' });
    const { events } = await as(a, a.member, (tx, context) =>
      handlers.updateRequestTask({
        tx,
        context,
        input: {
          params: { requestId: request, taskId: task.id },
          body: input({ dueOn: '2026-11-25' }),
        },
      }),
    );

    expect(events).toEqual([]);
  });

  it('answers 404 for a task under another request and for a request that is not here', async () => {
    const { result: task } = await createTask(a, request);

    expect(
      await refusal(
        as(a, a.member, (tx, context) =>
          handlers.completeRequestTask({
            tx,
            context,
            input: { params: { requestId: unknownId(), taskId: task.id } },
          }),
        ),
      ),
    ).toMatchObject({ status: 404 });
    expect(await refusal(createTask(a, unknownId()))).toMatchObject({ status: 404 });
  });

  it('is invisible and unchangeable from tenant B', async () => {
    const { result: task } = await createTask(a, request);
    const asB = <T>(work: Parameters<typeof as<T>>[2]) => as(b, b.member, work);
    const params = { requestId: request, taskId: task.id };

    const attempts = [
      () => asB((tx, context) => handlers.listRequestTasks({ tx, context, input: { params } })),
      () => createTask(b, request),
      () =>
        asB((tx, context) =>
          handlers.updateRequestTask({ tx, context, input: { params, body: input() } }),
        ),
      () => asB((tx, context) => handlers.completeRequestTask({ tx, context, input: { params } })),
    ];
    for (const attempt of attempts) {
      expect(await refusal(attempt())).toMatchObject({ status: 404 });
    }

    const { rows } = await asMigratorIn(a.tenant.id, (client) =>
      client.query<{ title: string; completed_by: string | null }>(
        'SELECT title, completed_by FROM privacy.request_task WHERE id = $1',
        [task.id],
      ),
    );
    expect(rows[0]).toEqual({ title: TITLE, completed_by: null });
  });
});
