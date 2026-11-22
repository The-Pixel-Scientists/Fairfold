// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Pause, resume, extend and close: each inserts one clock event by the
// session's member, recomputes the due date with the contracts' clock in the
// same transaction, and writes its audit event. The contracts' clock judges
// the change before it is written, with the request's row locked so two
// members' changes are judged one after the other; the database's trigger is
// the backstop, and its refusal answers as a coded problem, never a 500.

import {
  clockRefusalMessages,
  rightsRequestClock,
  type ClockEvent,
  type ClockRefusal,
  type RightsRequest,
} from '../../contracts/index.ts';
import type { PrivacyAuditAction } from '../../contracts/index.ts';
import {
  isRefusedByState,
  privacyDb,
  refusals,
  type Args,
  type PrivacyDependencies,
} from '../context.ts';
import type { RequestParams } from './handlers.ts';
import {
  clockEnv,
  readEventRows,
  readRequestRow,
  storedState,
  toClockEvent,
  toRightsRequest,
} from './read.ts';

/** Refusals about the date entered, which the member fixes in the form; the rest are about the request's state. */
const dateRefusals: ReadonlySet<ClockRefusal> = new Set([
  'in_future',
  'before_received',
  'out_of_order',
  'resume_before_pause',
]);

export interface Change {
  readonly on: string;
  readonly reason: string;
  readonly months?: 1 | 2;
}

const TABLE = 'privacy.rights_request';

export function clockHandlers(deps: PrivacyDependencies) {
  const change =
    (kind: ClockEvent['kind'], action: PrivacyAuditAction) =>
    async ({
      tx,
      context,
      input,
    }: Args<RequestParams & { body: Change }>): Promise<RightsRequest> => {
      const { requestId } = input.params;
      const { on, reason, months } = input.body;
      const found = await readRequestRow(tx, requestId, 'update');
      if (found === undefined) throw deps.notFound();

      const env = await clockEnv(deps, tx, context);
      const events = (await readEventRows(tx, [requestId])).map((event) =>
        toClockEvent(event, env.zone),
      );
      const added: ClockEvent =
        months === undefined
          ? ({ kind, on, recordedOn: env.today } as ClockEvent)
          : { kind: 'extended', on, recordedOn: env.today, months };
      const all = [...events, added];
      const clock = rightsRequestClock({
        receivedOn: found.received_on,
        events: all,
        nonWorkingDates: env.nonWorkingDates,
        today: env.today,
      });
      if (!clock.ok) {
        const message = clockRefusalMessages[clock.refusal];
        throw dateRefusals.has(clock.refusal)
          ? deps.refuse(400, message, [{ field: 'body.on', message }])
          : deps.refuse(409, message);
      }

      const db = privacyDb(tx);
      const state = storedState(clock.state, all);
      try {
        await db
          .insertInto('privacy.request_clock_event')
          .values((eb) => ({
            tenant_id: eb.fn<string>('app.current_tenant_id', []),
            request_id: requestId,
            kind,
            occurred_on: on,
            months: months ?? null,
            reason_code: reason,
            recorded_by: context.membership.id,
          }))
          .execute();
        await db
          .updateTable(TABLE)
          .set({ clock_state: state, due_on: clock.dueOn, updated_by: context.membership.id })
          .where('id', '=', requestId)
          .execute();
      } catch (error) {
        if (isRefusedByState(error)) throw deps.refuse(409, refusals.clockBusy);
        throw error;
      }

      await context.audit.record({
        action,
        entityId: requestId,
        changes: {
          'privacy.request_clock_event.occurred_on': { after: on },
          'privacy.request_clock_event.reason_code': { after: reason },
          ...(months === undefined
            ? {}
            : { 'privacy.request_clock_event.months': { after: months } }),
          [`${TABLE}.clock_state`]: { before: found.clock_state, after: state },
          [`${TABLE}.due_on`]: { before: found.due_on, after: clock.dueOn },
        },
      });
      return toRightsRequest(tx, { ...found, clock_state: state, due_on: clock.dueOn }, env);
    };

  return {
    pauseRightsRequest: change('paused', 'privacy.rights_request.paused'),
    resumeRightsRequest: change('resumed', 'privacy.rights_request.resumed'),
    extendRightsRequest: change('extended', 'privacy.rights_request.extended'),
    closeRightsRequest: change('closed', 'privacy.rights_request.closed'),
  };
}
