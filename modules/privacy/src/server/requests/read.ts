// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the rights request handlers share: a request with its clock events,
// and the clock as the contracts compute it. The server only calls the
// contracts' functions; it writes no date arithmetic of its own.

import {
  calendarDateIn,
  rightsRequestClock,
  type ClockEvent,
  type RightsRequest,
} from '../../contracts/index.ts';
import {
  iso,
  privacyDb,
  type PrivacyContext,
  type PrivacyDb,
  type PrivacyDependencies,
  type Tx,
} from '../context.ts';

/** What the clock is judged against, read once for a request. */
export interface ClockEnv {
  readonly zone: string;
  readonly today: string;
  readonly nonWorkingDates: ReadonlySet<string>;
}

export async function clockEnv(
  deps: PrivacyDependencies,
  tx: Tx,
  context: PrivacyContext,
): Promise<ClockEnv & { readonly now: Date }> {
  const zone = await deps.tenantTimeZone(tx, context.session.tenant);
  const now = deps.now();
  return {
    zone,
    now,
    today: calendarDateIn(iso(now), zone),
    nonWorkingDates: await deps.nonWorkingDates(tx),
  };
}

/** A request's own row, with its dates as text. */
export const selectRequests = (db: PrivacyDb) =>
  db
    .selectFrom('privacy.rights_request as r')
    .select((eb) => [
      'r.id',
      'r.kind',
      'r.subject_person_id',
      'r.received_at',
      eb.cast<string>('r.received_on', 'text').as('received_on'),
      'r.channel',
      'r.summary',
      'r.identity_check',
      'r.clock_state',
      eb.cast<string | null>('r.due_on', 'text').as('due_on'),
      'r.export_job_request_id',
      'r.erasure_job_request_id',
      'r.created_at',
      'r.updated_at',
    ]);

export type RequestRow = Awaited<
  ReturnType<ReturnType<typeof selectRequests>['executeTakeFirstOrThrow']>
>;

/** The request's row, locked for the rest of the transaction when it is to change. */
export async function readRequestRow(
  tx: Tx,
  requestId: string,
  lock: 'update' | null = null,
): Promise<RequestRow | undefined> {
  const query = selectRequests(privacyDb(tx)).where('r.id', '=', requestId);
  return lock === null ? query.executeTakeFirst() : query.forUpdate().executeTakeFirst();
}

type EventRow = Awaited<ReturnType<typeof readEventRows>>[number];

/** The events of these requests, in the order they were recorded. */
export const readEventRows = (tx: Tx, requestIds: readonly string[]) =>
  requestIds.length === 0
    ? Promise.resolve([])
    : privacyDb(tx)
        .selectFrom('privacy.request_clock_event as e')
        .select((eb) => [
          'e.request_id',
          'e.kind',
          eb.cast<string>('e.occurred_on', 'text').as('occurred_on'),
          'e.months',
          'e.reason_code',
          'e.recorded_by',
          'e.created_at',
        ])
        .where('e.request_id', 'in', requestIds)
        .orderBy('e.created_at')
        .orderBy('e.id')
        .execute();

/** The event as the clock function reads it. */
export function toClockEvent(row: EventRow, zone: string): ClockEvent {
  const base = { on: row.occurred_on, recordedOn: calendarDateIn(iso(row.created_at), zone) };
  return row.kind === 'extended'
    ? { ...base, kind: 'extended', months: row.months === 2 ? 2 : 1 }
    : { ...base, kind: row.kind as 'paused' | 'resumed' | 'closed' };
}

type StoredState = 'running' | 'paused' | 'extended' | 'closed';

/**
 * The clock of a request. A refusal here means the events no longer pass
 * the contract (the tenant's time zone changed after they were recorded),
 * and the request must still read, so the stored state and due date stand.
 */
export function clockOf(
  row: Pick<RequestRow, 'received_on' | 'clock_state' | 'due_on'>,
  events: readonly ClockEvent[],
  env: ClockEnv,
): RightsRequest['clock'] {
  const clock = rightsRequestClock({
    receivedOn: row.received_on,
    events,
    nonWorkingDates: env.nonWorkingDates,
    today: env.today,
  });
  return clock.ok
    ? { state: clock.state, dueOn: clock.dueOn }
    : { state: row.clock_state as StoredState, dueOn: row.due_on };
}

/** The state to store: what the clock says, but running or extended while it is overdue. */
export function storedState(
  state: RightsRequest['clock']['state'],
  events: readonly ClockEvent[],
): StoredState {
  if (state === 'closed' || state === 'paused') return state;
  return events.some((event) => event.kind === 'extended') ? 'extended' : 'running';
}

const toEvent = (row: EventRow): RightsRequest['clockEvents'][number] =>
  ({
    kind: row.kind,
    on: row.occurred_on,
    membershipId: row.recorded_by,
    recordedAt: iso(row.created_at),
    reason: row.reason_code,
    ...(row.months === null ? {} : { months: row.months }),
  }) as RightsRequest['clockEvents'][number];

export async function toRightsRequest(
  tx: Tx,
  row: RequestRow,
  env: ClockEnv,
): Promise<RightsRequest> {
  const events = await readEventRows(tx, [row.id]);
  return {
    id: row.id,
    kind: row.kind as RightsRequest['kind'],
    personId: row.subject_person_id,
    receivedAt: iso(row.received_at),
    receivedOn: row.received_on,
    channel: row.channel as RightsRequest['channel'],
    summary: row.summary ?? '',
    identityCheck: row.identity_check as RightsRequest['identityCheck'],
    clock: clockOf(
      row,
      events.map((event) => toClockEvent(event, env.zone)),
      env,
    ),
    clockEvents: events.map(toEvent),
    exportRequestId: row.export_job_request_id,
    erasureRequestId: row.erasure_job_request_id,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}
