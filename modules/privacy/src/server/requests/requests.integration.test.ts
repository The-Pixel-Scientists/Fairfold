// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The rights request routes' handlers against the test database, as app_api
// in a tenant's transaction: the received date in the tenant's time zone,
// the due date as the contracts' clock gives it, each clock change as its
// own audited event, refusals that echo nothing sent, and tenant B unable to
// read or change tenant A's requests. Permission and module-off answers are
// the platform's, in front of these handlers.
//
// The database stamps each clock event with its own clock, so these tests
// judge deadlines by the real time and date everything relative to today.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addCalendarMonths, calendarDateIn, nextWorkingDay } from '../../contracts/index.ts';
import {
  addFixture,
  as,
  clock,
  closeDatabase,
  handlers,
  openDatabase,
  refusal,
  unknownId,
  type Fixture,
} from '../harness.integration.test.ts';

const SUMMARY = 'Synthetic request for a copy of their records';
const DAY = 86_400_000;

let today: string;

const plusDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/** The date `days` from today, in the tenant's time zone (negative for the past). */
const on = (days: number): string => plusDays(today, days);

/** The deadline the contracts give a request received on `received`, with `paused` days added. */
const due = (received: string, months: number, paused = 0): string =>
  nextWorkingDay(plusDays(addCalendarMonths(received, months), paused), new Set());

const body = (person: string, change: Record<string, unknown> = {}) => ({
  personId: person,
  receivedAt: `${on(-16)}T10:00:00.000Z`,
  kind: 'access' as const,
  channel: 'email' as const,
  summary: SUMMARY,
  identityCheck: 'not_started' as const,
  ...change,
});

let a: Fixture;
let b: Fixture;

beforeAll(async () => {
  clock.now = new Date();
  today = calendarDateIn(clock.now.toISOString(), 'Europe/London');
  openDatabase();
  a = await addFixture();
  b = await addFixture();
}, 60_000);

afterAll(closeDatabase);

const create = (fixture: Fixture, change: Record<string, unknown> = {}) =>
  as(fixture, fixture.member, (tx, context) =>
    handlers.createRightsRequest({ tx, context, input: { body: body(fixture.person, change) } }),
  );

const clockChange = (
  fixture: Fixture,
  requestId: string,
  action: 'pause' | 'resume' | 'extend' | 'close',
  change: Record<string, unknown>,
) =>
  as(fixture, fixture.member, (tx, context) =>
    handlers[`${action}RightsRequest`]({
      tx,
      context,
      input: { params: { requestId }, body: change as never },
    }),
  );

const read = (fixture: Fixture, requestId: string) =>
  as(fixture, fixture.member, (tx, context) =>
    handlers.replayRequest({ tx, context, input: undefined, id: requestId }),
  ).then(({ result }) => result);

describe('createRightsRequest', () => {
  it('derives the received date in the tenant time zone and the due date from the contracts', async () => {
    const { result, events } = await create(a);

    expect(result).toMatchObject({
      personId: a.person,
      receivedOn: on(-16),
      clock: { state: 'running', dueOn: due(on(-16), 1) },
      clockEvents: [],
      exportRequestId: null,
    });
    expect(events).toEqual([
      expect.objectContaining({
        kind: 'record',
        action: 'privacy.rights_request.created',
        entityId: result.id,
        subject: a.person,
      }),
    ]);
  });

  it('reads a summer midnight as the next day in London and rolls a weekend due date to Monday', async () => {
    const { result } = await create(a, { receivedAt: '2026-06-30T23:30:00.000Z' });

    expect(result.receivedOn).toBe('2026-07-01');
    expect(result.clock).toEqual({ state: 'overdue', dueOn: '2026-08-03' });
  });

  it('refuses a received time after today, naming the field', async () => {
    const refused = await refusal(create(a, { receivedAt: `${on(2)}T09:00:00.000Z` }));

    expect(refused.status).toBe(400);
    expect(refused.errors).toEqual([
      { field: 'body.receivedAt', message: 'Enter a date that is today or earlier.' },
    ]);
  });

  it('answers the same problem for a missing person and another tenant’s, never echoing what was sent', async () => {
    const secret = 'Synthetic summary that must not be repeated';
    const other = await refusal(create(a, { personId: b.person, summary: secret }));
    const missing = await refusal(create(a, { personId: unknownId(), summary: secret }));

    expect(other).toMatchObject({ status: 400, errors: missing.errors });
    for (const refused of [other, missing]) {
      expect(JSON.stringify([refused.message, refused.errors])).not.toMatch(
        new RegExp(`${b.person}|${secret}`),
      );
    }
  });
});

describe('reading and listing', () => {
  it('writes a viewed event for the request’s person when a request is read, and none for a list', async () => {
    const { result: created } = await create(a);
    const { result, events } = await as(a, a.second, (tx, context) =>
      handlers.getRightsRequest({ tx, context, input: { params: { requestId: created.id } } }),
    );
    const list = await as(a, a.member, (tx, context) =>
      handlers.listRightsRequests({ tx, context, input: { query: {} } }),
    );

    expect(result.summary).toBe(SUMMARY);
    expect(events).toEqual([
      expect.objectContaining({
        kind: 'read',
        action: 'privacy.rights_request.viewed',
        entityId: created.id,
        subject: a.person,
      }),
    ]);
    expect(list.events).toEqual([]);
    expect(JSON.stringify(list.result)).not.toContain(SUMMARY);
  });

  it('lists by kind and state, the soonest due first and paused ones last, and refuses a bad cursor', async () => {
    const fixture = await addFixture();
    const soon = (await create(fixture, { receivedAt: `${on(-10)}T10:00:00.000Z` })).result;
    const later = (
      await create(fixture, { kind: 'erasure', receivedAt: `${on(-2)}T10:00:00.000Z` })
    ).result;
    const paused = (await create(fixture, { receivedAt: `${on(-3)}T10:00:00.000Z` })).result;
    await clockChange(fixture, paused.id, 'pause', { on: on(-2), reason: 'identity_proof' });
    const overdue = (await create(fixture, { receivedAt: `${on(-60)}T10:00:00.000Z` })).result;
    const list = (query: Record<string, string>) =>
      as(fixture, fixture.member, (tx, context) =>
        handlers.listRightsRequests({ tx, context, input: { query } }),
      ).then(({ result }) => result.requests.map(({ id }) => id));

    expect(await list({})).toEqual([overdue.id, soon.id, later.id, paused.id]);
    expect(await list({ kind: 'erasure' })).toEqual([later.id]);
    expect(await list({ state: 'overdue' })).toEqual([overdue.id]);
    expect(await list({ state: 'paused' })).toEqual([paused.id]);
    expect(await list({ state: 'running' })).toEqual([soon.id, later.id]);
    expect(await list({ dueWithinDays: '25' })).toEqual([overdue.id, soon.id]);
    expect(await refusal(list({ cursor: 'bad' }))).toMatchObject({ status: 400 });
  }, 30_000);
});

describe('updateRightsRequest', () => {
  it('changes the details, audits the columns changed with no text, and leaves the person and times', async () => {
    const { result: created } = await create(a);
    const { result, events } = await as(a, a.second, (tx, context) =>
      handlers.updateRightsRequest({
        tx,
        context,
        input: {
          params: { requestId: created.id },
          body: {
            kind: 'access',
            channel: 'post',
            summary: 'Synthetic changed summary',
            identityCheck: 'verified',
          },
        },
      }),
    );

    expect(result).toMatchObject({
      channel: 'post',
      identityCheck: 'verified',
      personId: a.person,
      receivedOn: on(-16),
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'privacy.rights_request.updated',
      subject: a.person,
      changes: {
        'privacy.rights_request.channel': { before: 'email', after: 'post' },
        'privacy.rights_request.identity_check': { before: 'not_started', after: 'verified' },
        'privacy.rights_request.summary': {},
      },
    });
    expect(JSON.stringify(events)).not.toContain('changed summary');
  });

  it('writes nothing when nothing changed', async () => {
    const { result: created } = await create(a);
    const { events } = await as(a, a.member, (tx, context) =>
      handlers.updateRightsRequest({
        tx,
        context,
        input: {
          params: { requestId: created.id },
          body: {
            kind: created.kind,
            channel: created.channel,
            summary: created.summary,
            identityCheck: created.identityCheck,
          },
        },
      }),
    );

    expect(events).toEqual([]);
  });
});

describe('the clock', () => {
  it('pauses, resumes, extends and closes, each its own audited event with the due date recomputed', async () => {
    const received = on(-20);
    const { result: created } = await create(a, { receivedAt: `${received}T10:00:00.000Z` });
    const id = created.id;

    const paused = await clockChange(a, id, 'pause', { on: on(-19), reason: 'identity_proof' });
    expect(paused.result.clock).toEqual({ state: 'paused', dueOn: null });

    const resumed = await clockChange(a, id, 'resume', {
      on: on(-12),
      reason: 'information_received',
    });
    expect(resumed.result.clock).toEqual({ state: 'running', dueOn: due(received, 1, 7) });

    const extended = await clockChange(a, id, 'extend', {
      on: on(-11),
      months: 1,
      reason: 'complex',
    });
    expect(extended.result.clock).toEqual({ state: 'extended', dueOn: due(received, 2, 7) });

    const closed = await clockChange(a, id, 'close', { on: on(0), reason: 'completed' });
    expect(closed.result.clock.state).toBe('closed');
    expect(closed.result.clockEvents.map(({ kind, membershipId }) => [kind, membershipId])).toEqual(
      [
        ['paused', a.member],
        ['resumed', a.member],
        ['extended', a.member],
        ['closed', a.member],
      ],
    );

    expect(
      [paused, resumed, extended, closed].map(({ events }) => [
        events[0]?.action,
        events[0]?.subject,
      ]),
    ).toEqual([
      ['privacy.rights_request.paused', a.person],
      ['privacy.rights_request.resumed', a.person],
      ['privacy.rights_request.extended', a.person],
      ['privacy.rights_request.closed', a.person],
    ]);
    expect(paused.events[0]?.changes).toMatchObject({
      'privacy.request_clock_event.reason_code': { after: 'identity_proof' },
      'privacy.rights_request.due_on': { before: due(received, 1), after: null },
    });
  });

  it('refuses a change the clock cannot follow with its own words and writes nothing', async () => {
    const { result: created } = await create(a, { receivedAt: `${on(-20)}T10:00:00.000Z` });
    const id = created.id;
    await clockChange(a, id, 'pause', { on: on(-19), reason: 'clarification' });

    expect(
      await refusal(clockChange(a, id, 'pause', { on: on(-18), reason: 'clarification' })),
    ).toMatchObject({
      status: 409,
      message: 'The clock is already stopped. Restart it before stopping it again.',
    });
    expect(
      await refusal(clockChange(a, id, 'resume', { on: on(1), reason: 'information_received' })),
    ).toMatchObject({ status: 400, errors: [{ field: 'body.on' }] });
    expect(
      await refusal(clockChange(a, id, 'resume', { on: on(-21), reason: 'information_received' })),
    ).toMatchObject({ status: 400, errors: [{ field: 'body.on' }] });

    await clockChange(a, id, 'resume', { on: on(-17), reason: 'no_longer_needed' });
    expect(
      await refusal(clockChange(a, id, 'resume', { on: on(-16), reason: 'no_longer_needed' })),
    ).toMatchObject({
      status: 409,
      message: 'The clock is running. Stop it before restarting it.',
    });
    await clockChange(a, id, 'extend', { on: on(-16), months: 2, reason: 'numerous' });
    expect(
      await refusal(clockChange(a, id, 'extend', { on: on(-15), months: 1, reason: 'complex' })),
    ).toMatchObject({ status: 409 });
    await clockChange(a, id, 'close', { on: on(-14), reason: 'withdrawn' });
    expect(
      await refusal(clockChange(a, id, 'pause', { on: on(-13), reason: 'clarification' })),
    ).toMatchObject({ status: 409 });

    expect((await read(a, id)).clockEvents.map(({ kind }) => kind)).toEqual([
      'paused',
      'resumed',
      'extended',
      'closed',
    ]);
  });

  it('refuses a pause after the deadline has passed', async () => {
    const { result } = await create(a, { receivedAt: `${on(-60)}T10:00:00.000Z` });

    expect(
      await refusal(clockChange(a, result.id, 'pause', { on: on(-50), reason: 'identity_proof' })),
    ).toMatchObject({
      status: 409,
      message: 'The deadline has passed, so the clock cannot be stopped. Respond now.',
    });
  });
});

describe('another tenant', () => {
  it('finds tenant A’s request missing, and changes and writes nothing', async () => {
    const { result: created } = await create(a);
    const id = created.id;
    const asB = <T>(work: Parameters<typeof as<T>>[2]) => as(b, b.member, work);
    const change = { on: on(-5), reason: 'complex', months: 1 } as never;

    const attempts = [
      () =>
        asB((tx, context) =>
          handlers.getRightsRequest({ tx, context, input: { params: { requestId: id } } }),
        ),
      () =>
        asB((tx, context) =>
          handlers.updateRightsRequest({
            tx,
            context,
            input: {
              params: { requestId: id },
              body: {
                kind: 'erasure',
                channel: 'post',
                summary: 'Synthetic',
                identityCheck: 'failed',
              },
            },
          }),
        ),
      ...(['pause', 'resume', 'extend', 'close'] as const).map(
        (action) => () =>
          asB((tx, context) =>
            handlers[`${action}RightsRequest`]({
              tx,
              context,
              input: { params: { requestId: id }, body: change },
            }),
          ),
      ),
    ];
    for (const attempt of attempts) expect(await refusal(attempt())).toMatchObject({ status: 404 });

    const { result: listed } = await asB((tx, context) =>
      handlers.listRightsRequests({ tx, context, input: { query: {} } }),
    );
    expect(listed.requests.map(({ id: listedId }) => listedId)).not.toContain(id);
    expect(await read(a, id)).toMatchObject({ kind: 'access', channel: 'email', clockEvents: [] });
  });
});
