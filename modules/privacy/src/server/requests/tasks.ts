// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The request task routes' handlers: the work a rights request needs. A task
// is assigned to an active member of the caller's tenant and optionally to
// the tool whose records it concerns. `completed_by` is the session's
// member, and the database sets the time. A task's title is personal data.

import {
  MAX_REQUEST_TASKS,
  type RequestTask,
  type RequestTaskInput,
} from '../../contracts/index.ts';
import {
  changedColumns,
  isRefusedByState,
  iso,
  privacyDb,
  refusals,
  type Args,
  type PrivacyDb,
  type PrivacyDependencies,
  type ReplayArgs,
} from '../context.ts';
import type { RequestParams } from './handlers.ts';
import { readRequestRow } from './read.ts';

export interface TaskParams extends RequestParams {
  readonly params: { readonly requestId: string; readonly taskId: string };
}

const TABLE = 'privacy.request_task';

const selectTasks = (db: PrivacyDb) =>
  db
    .selectFrom('privacy.request_task as t')
    .select((eb) => [
      't.id',
      't.request_id',
      't.title',
      't.assigned_to',
      't.module_id',
      eb.cast<string | null>('t.due_on', 'text').as('due_on'),
      't.completed_at',
      't.created_at',
    ])
    .orderBy('t.created_at')
    .orderBy('t.id');

type TaskRow = Awaited<ReturnType<ReturnType<typeof selectTasks>['executeTakeFirstOrThrow']>>;

const toTask = (row: TaskRow): RequestTask => ({
  id: row.id,
  requestId: row.request_id,
  title: row.title,
  assigneeMembershipId: row.assigned_to,
  moduleId: row.module_id as RequestTask['moduleId'],
  dueOn: row.due_on,
  completedAt: row.completed_at === null ? null : iso(row.completed_at),
  createdAt: iso(row.created_at),
});

export function taskHandlers(deps: PrivacyDependencies) {
  async function readTask(tx: Args<unknown>['tx'], requestId: string, taskId: string) {
    return selectTasks(privacyDb(tx))
      .where('t.request_id', '=', requestId)
      .where('t.id', '=', taskId)
      .executeTakeFirst();
  }

  /** Refuses an assignee who is not an active member of this tenant, which row-level security leaves unseen. */
  async function checkAssignee(tx: Args<unknown>['tx'], membershipId: string | null) {
    if (membershipId === null) return;
    const member = await privacyDb(tx)
      .selectFrom('app.membership')
      .select('id')
      .where('id', '=', membershipId)
      .where('status', '=', 'active')
      .executeTakeFirst();
    if (member === undefined) {
      const message = refusals.assignee;
      throw deps.refuse(400, message, [{ field: 'body.assigneeMembershipId', message }]);
    }
  }

  async function listRequestTasks({ tx, input }: Args<RequestParams>) {
    const { requestId } = input.params;
    if ((await readRequestRow(tx, requestId)) === undefined) throw deps.notFound();
    const rows = await selectTasks(privacyDb(tx))
      .where('t.request_id', '=', requestId)
      .limit(MAX_REQUEST_TASKS)
      .execute();
    return { tasks: rows.map(toTask) };
  }

  async function createRequestTask({
    tx,
    context,
    input,
  }: Args<RequestParams & { body: RequestTaskInput }>): Promise<RequestTask> {
    const { requestId } = input.params;
    const { title, assigneeMembershipId, moduleId, dueOn } = input.body;
    if ((await readRequestRow(tx, requestId, 'update')) === undefined) throw deps.notFound();
    const db = privacyDb(tx);
    const { count } = await db
      .selectFrom(TABLE)
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('request_id', '=', requestId)
      .executeTakeFirstOrThrow();
    if (Number(count) >= MAX_REQUEST_TASKS) throw deps.refuse(409, refusals.tooManyTasks);
    await checkAssignee(tx, assigneeMembershipId);

    const actor = context.membership.id;
    const { id } = await db
      .insertInto(TABLE)
      .values((eb) => ({
        tenant_id: eb.fn<string>('app.current_tenant_id', []),
        request_id: requestId,
        title,
        assigned_to: assigneeMembershipId,
        module_id: moduleId,
        due_on: dueOn,
        created_by: actor,
        updated_by: actor,
      }))
      .returning('id')
      .executeTakeFirstOrThrow();
    await context.audit.record({
      action: 'privacy.request_task.created',
      entityId: id,
      changes: {
        [`${TABLE}.assigned_to`]: { after: assigneeMembershipId },
        [`${TABLE}.module_id`]: { after: moduleId },
        [`${TABLE}.due_on`]: { after: dueOn },
      },
    });
    return toTask(await readTaskOrThrow(tx, requestId, id));
  }

  async function readTaskOrThrow(tx: Args<unknown>['tx'], requestId: string, taskId: string) {
    const row = await readTask(tx, requestId, taskId);
    if (row === undefined) throw deps.notFound();
    return row;
  }

  async function updateRequestTask({
    tx,
    context,
    input,
  }: Args<TaskParams & { body: RequestTaskInput }>): Promise<RequestTask> {
    const { requestId, taskId } = input.params;
    const { title, assigneeMembershipId, moduleId, dueOn } = input.body;
    const found = await readTaskOrThrow(tx, requestId, taskId);
    const after = {
      title,
      assigned_to: assigneeMembershipId,
      module_id: moduleId,
      due_on: dueOn,
    };
    const changes = changedColumns(
      TABLE,
      {
        title: found.title,
        assigned_to: found.assigned_to,
        module_id: found.module_id,
        due_on: found.due_on,
      },
      after,
      ['assigned_to', 'module_id', 'due_on'],
      ['title'],
    );
    if (Object.keys(changes).length === 0) return toTask(found);
    if (assigneeMembershipId !== found.assigned_to) await checkAssignee(tx, assigneeMembershipId);

    try {
      await privacyDb(tx)
        .updateTable(TABLE)
        .set({ ...after, updated_by: context.membership.id })
        .where('id', '=', taskId)
        .execute();
    } catch (error) {
      if (isRefusedByState(error)) throw deps.refuse(409, refusals.erased);
      throw error;
    }
    await context.audit.record({
      action: 'privacy.request_task.updated',
      entityId: taskId,
      changes,
    });
    return toTask(await readTaskOrThrow(tx, requestId, taskId));
  }

  async function completeRequestTask({
    tx,
    context,
    input,
  }: Args<TaskParams>): Promise<RequestTask> {
    const { requestId, taskId } = input.params;
    const found = await readTaskOrThrow(tx, requestId, taskId);
    if (found.completed_at !== null) return toTask(found);

    await privacyDb(tx)
      .updateTable(TABLE)
      .set({ completed_by: context.membership.id, updated_by: context.membership.id })
      .where('id', '=', taskId)
      .where('completed_by', 'is', null)
      .execute();
    await context.audit.record({ action: 'privacy.request_task.completed', entityId: taskId });
    return toTask(await readTaskOrThrow(tx, requestId, taskId));
  }

  /** Answers a replayed create with the task as it reads now. */
  const replayRequestTask = ({ tx, input, id }: ReplayArgs<RequestParams>) =>
    id === null
      ? Promise.reject(deps.notFound())
      : readTaskOrThrow(tx, input.params.requestId, id).then(toTask);

  return {
    listRequestTasks,
    createRequestTask,
    updateRequestTask,
    completeRequestTask,
    replayRequestTask,
  };
}
