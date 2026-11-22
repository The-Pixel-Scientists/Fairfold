// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The rights request routes' handlers. The platform has already checked the
// session, the permission and that privacy is on. The received date comes
// from the received time in the tenant's time zone, never from the request,
// and the due date from the contracts' clock. Nothing here decides a request
// (rule 9): the members' actions change it, and each writes its audit event.

import {
  calendarDateIn,
  clockRefusalMessages,
  rightsRequestClock,
  type RightsRequest,
  type RightsRequestInput,
  type RightsRequestQuery,
  type RightsRequestUpdate,
} from '../../contracts/index.ts';
import {
  changedColumns,
  isMissingReference,
  isRefusedByState,
  privacyDb,
  refusals,
  type Args,
  type PrivacyDependencies,
  type ReplayArgs,
} from '../context.ts';
import { decodeCursor, PAGE_SIZE, toPage } from '../page.ts';
import {
  clockEnv,
  clockOf,
  readEventRows,
  readRequestRow,
  selectRequests,
  toClockEvent,
  toRightsRequest,
} from './read.ts';

export interface RequestParams {
  readonly params: { readonly requestId: string };
}

type Summary = Pick<
  RightsRequest,
  'id' | 'kind' | 'personId' | 'receivedOn' | 'channel' | 'identityCheck' | 'clock'
>;

const TABLE = 'privacy.rights_request';
const DETAILS = ['kind', 'channel', 'identity_check'] as const;

export function requestHandlers(deps: PrivacyDependencies) {
  async function readRequest({ tx, context, input }: Args<RequestParams>): Promise<RightsRequest> {
    const row = await readRequestRow(tx, input.params.requestId);
    if (row === undefined) throw deps.notFound();
    return toRightsRequest(tx, row, await clockEnv(deps, tx, context));
  }

  async function listRightsRequests({
    tx,
    context,
    input,
  }: Args<{ query: RightsRequestQuery }>): Promise<{
    requests: Summary[];
    nextCursor: string | null;
  }> {
    const { kind, state, dueWithinDays, cursor } = input.query;
    const offset = decodeCursor(cursor);
    if (offset === null) throw deps.refuse(400, refusals.page);
    const env = await clockEnv(deps, tx, context);

    let query = selectRequests(privacyDb(tx));
    if (kind !== undefined) query = query.where('r.kind', '=', kind);
    if (state === 'paused' || state === 'closed') query = query.where('r.clock_state', '=', state);
    if (state === 'running' || state === 'extended') {
      query = query.where('r.clock_state', '=', state).where('r.due_on', '>=', env.today);
    }
    if (state === 'overdue') {
      query = query
        .where('r.clock_state', 'in', ['running', 'extended'])
        .where('r.due_on', '<', env.today);
    }
    if (dueWithinDays !== undefined) {
      query = query
        .where('r.clock_state', '<>', 'closed')
        .where((eb) =>
          eb(
            'r.due_on',
            '<=',
            eb.cast<string>(
              eb(
                eb.cast<string>(eb.val(env.today), 'date'),
                '+',
                eb.cast<string>(eb.val(Number(dueWithinDays)), 'integer'),
              ),
              'date',
            ),
          ),
        );
    }
    const rows = await query
      .orderBy('r.due_on', (order) => order.asc().nullsLast())
      .orderBy('r.id')
      .limit(PAGE_SIZE + 1)
      .offset(offset)
      .execute();
    const { items, nextCursor } = toPage(rows, offset);
    const events = await readEventRows(
      tx,
      items.map((row) => row.id),
    );
    return {
      requests: items.map((row) => ({
        id: row.id,
        kind: row.kind as RightsRequest['kind'],
        personId: row.subject_person_id,
        receivedOn: row.received_on,
        channel: row.channel as RightsRequest['channel'],
        identityCheck: row.identity_check as RightsRequest['identityCheck'],
        clock: clockOf(
          row,
          events
            .filter((event) => event.request_id === row.id)
            .map((event) => toClockEvent(event, env.zone)),
          env,
        ),
      })),
      nextCursor,
    };
  }

  async function createRightsRequest({
    tx,
    context,
    input,
  }: Args<{ body: RightsRequestInput }>): Promise<RightsRequest> {
    const { personId, receivedAt, kind, channel, summary, identityCheck } = input.body;
    const env = await clockEnv(deps, tx, context);
    const receivedOn = calendarDateIn(receivedAt, env.zone);
    const clock = rightsRequestClock({
      receivedOn,
      events: [],
      nonWorkingDates: env.nonWorkingDates,
      today: env.today,
    });
    if (!clock.ok) {
      const message = clockRefusalMessages[clock.refusal];
      throw deps.refuse(400, message, [{ field: 'body.receivedAt', message }]);
    }

    const actor = context.membership.id;
    let id: string;
    try {
      ({ id } = await privacyDb(tx)
        .insertInto(TABLE)
        .values((eb) => ({
          tenant_id: eb.fn<string>('app.current_tenant_id', []),
          kind,
          subject_person_id: personId,
          received_at: receivedAt,
          received_on: receivedOn,
          channel,
          summary,
          identity_check: identityCheck,
          due_on: clock.dueOn,
          created_by: actor,
          updated_by: actor,
        }))
        .returning('id')
        .executeTakeFirstOrThrow());
    } catch (error) {
      // A person who is missing, in another tenant or erased reads the same, and the id is not echoed.
      if (isMissingReference(error) || isRefusedByState(error)) {
        const message = refusals.person;
        throw deps.refuse(400, message, [{ field: 'body.personId', message }]);
      }
      throw error;
    }
    await context.audit.record({
      action: 'privacy.rights_request.created',
      entityId: id,
      changes: {
        [`${TABLE}.kind`]: { after: kind },
        [`${TABLE}.channel`]: { after: channel },
        [`${TABLE}.identity_check`]: { after: identityCheck },
        [`${TABLE}.received_on`]: { after: receivedOn },
        [`${TABLE}.due_on`]: { after: clock.dueOn },
      },
    });
    return readRequest({ tx, context, input: { params: { requestId: id } } });
  }

  async function getRightsRequest(args: Args<RequestParams>): Promise<RightsRequest> {
    const request = await readRequest(args);
    await args.context.audit.read({
      action: 'privacy.rights_request.viewed',
      entityId: request.id,
    });
    return request;
  }

  async function updateRightsRequest({
    tx,
    context,
    input,
  }: Args<RequestParams & { body: RightsRequestUpdate }>): Promise<RightsRequest> {
    const { requestId } = input.params;
    const { kind, channel, summary, identityCheck } = input.body;
    const found = await readRequestRow(tx, requestId, 'update');
    if (found === undefined) throw deps.notFound();
    const after = { kind, channel, identity_check: identityCheck };
    const changes = changedColumns(
      TABLE,
      {
        kind: found.kind,
        channel: found.channel,
        identity_check: found.identity_check,
        summary: found.summary,
      },
      { ...after, summary },
      DETAILS,
      ['summary'],
    );

    if (Object.keys(changes).length > 0) {
      try {
        await privacyDb(tx)
          .updateTable(TABLE)
          .set({ ...after, summary, updated_by: context.membership.id })
          .where('id', '=', requestId)
          .execute();
      } catch (error) {
        if (isRefusedByState(error)) throw deps.refuse(409, refusals.erased);
        throw error;
      }
      await context.audit.record({
        action: 'privacy.rights_request.updated',
        entityId: requestId,
        changes,
      });
    }
    return readRequest({ tx, context, input: { params: { requestId } } });
  }

  /**
   * Answers a replayed create or clock change with the request as it reads now. The first
   * answer's event stays the record, so a replay writes no view event.
   */
  const replayRequest = ({ tx, context, id }: ReplayArgs<unknown>) =>
    id === null
      ? Promise.reject(deps.notFound())
      : readRequest({ tx, context, input: { params: { requestId: id } } });

  return {
    listRightsRequests,
    createRightsRequest,
    getRightsRequest,
    updateRightsRequest,
    replayRequest,
  };
}
