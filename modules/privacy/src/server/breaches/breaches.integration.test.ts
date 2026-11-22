// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The breach log's handlers against the test database, as app_api in a
// tenant's transaction: the 72-hour clock on every answer, assessments that
// are only ever added, the ICO and subject notifications as separate named
// actions that nothing here sends, text that never reaches an audit event,
// and tenant B unable to reach tenant A's breaches.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asMigratorIn } from '../../../../../packages/db/test/tenants.ts';
import {
  addFixture,
  as,
  closeDatabase,
  handlers,
  openDatabase,
  refusal,
  type Fixture,
} from '../harness.integration.test.ts';

const DESCRIPTION = 'Synthetic email sent to the wrong list';

const input = (change: Record<string, unknown> = {}) => ({
  becameAwareAt: '2026-11-16T12:00:00.000Z',
  discoveredAt: '2026-11-16T09:00:00.000Z',
  description: DESCRIPTION,
  dataCategories: ['contact'],
  approximateSubjects: 12,
  approximateRecords: null,
  likelyConsequences: 'Synthetic consequence',
  measuresTaken: 'Synthetic measure',
  ...change,
});

/** A breach update, which carries every field but when the tenant became aware. */
const updateBody = (change: Record<string, unknown> = {}) => ({
  discoveredAt: '2026-11-16T09:00:00.000Z',
  description: DESCRIPTION,
  dataCategories: ['contact'],
  approximateSubjects: 12,
  approximateRecords: null,
  likelyConsequences: 'Synthetic consequence',
  measuresTaken: 'Synthetic measure',
  ...change,
});

let a: Fixture;
let b: Fixture;

beforeAll(async () => {
  openDatabase();
  a = await addFixture();
  b = await addFixture();
}, 60_000);

afterAll(closeDatabase);

const record = (fixture: Fixture, change: Record<string, unknown> = {}) =>
  as(fixture, fixture.member, (tx, context) =>
    handlers.createBreach({ tx, context, input: { body: input(change) as never } }),
  );

const params = (breachId: string) => ({ params: { breachId } });

describe('createBreach and getBreach', () => {
  it('records a breach with its clock, audits it without its text, and flags special category data', async () => {
    const { result, events } = await record(a, { dataCategories: ['contact', 'health'] });

    expect(result).toMatchObject({
      becameAwareAt: '2026-11-16T12:00:00.000Z',
      specialCategory: true,
      approximateSubjects: 12,
      approximateRecords: null,
      assessments: [],
      icoNotification: null,
      clock: { deadline: '2026-11-19T12:00:00.000Z', hoursRemaining: 24, late: false },
    });
    expect(events).toEqual([
      {
        kind: 'record',
        action: 'privacy.breach.recorded',
        entityId: result.id,
        subject: null,
        changes: {
          'privacy.breach.became_aware_at': { after: '2026-11-16T12:00:00.000Z' },
          'privacy.breach.discovered_at': { after: '2026-11-16T09:00:00.000Z' },
          'privacy.breach.data_categories': { after: ['contact', 'health'] },
        },
      },
    ]);
    expect(JSON.stringify(events)).not.toMatch(/Synthetic (email|consequence|measure)/);

    const read = await as(a, a.second, (tx, context) =>
      handlers.getBreach({ tx, context, input: params(result.id) }),
    );
    expect(read.result.description).toBe(DESCRIPTION);
    expect(read.events).toEqual([
      { kind: 'read', action: 'privacy.breach.viewed', entityId: result.id, subject: null },
    ]);
  });

  it('refuses an awareness or discovery time after now, so the clock cannot start late', async () => {
    const refused = await refusal(record(a, { becameAwareAt: '2026-11-18T12:00:01.000Z' }));

    expect(refused).toMatchObject({
      status: 400,
      errors: [{ field: 'body.becameAwareAt', message: 'Enter a time that is now or earlier.' }],
    });
    expect(await refusal(record(a, { discoveredAt: '2026-11-19T00:00:00.000Z' }))).toMatchObject({
      status: 400,
    });
  });

  it('lists the newest first with the clock, current risk level and whether the ICO was told', async () => {
    const fixture = await addFixture();
    const older = (await record(fixture, { becameAwareAt: '2026-11-10T09:00:00.000Z' })).result;
    const newer = (await record(fixture)).result;
    await as(fixture, fixture.member, (tx, context) =>
      handlers.assessBreach({
        tx,
        context,
        input: {
          ...params(older.id),
          body: { riskLevel: 'high_risk', notifyIco: true, notifySubjects: true, rationale: '' },
        },
      }),
    );

    const { result } = await as(fixture, fixture.member, (tx, context) =>
      handlers.listBreaches({ tx, context, input: { query: {} } }),
    );
    expect(result.breaches.map(({ id }) => id)).toEqual([newer.id, older.id]);
    expect(result.breaches[1]).toMatchObject({
      riskLevel: 'high_risk',
      icoNotified: false,
      clock: { hoursRemaining: 0, late: true },
    });
    expect(result.breaches[0]).toMatchObject({ riskLevel: null });
    expect(JSON.stringify(result)).not.toContain(DESCRIPTION);
  });
});

describe('updateBreach', () => {
  it('changes the details but never when the tenant became aware, and audits the columns by name', async () => {
    const { result: created } = await record(a);
    const body = updateBody({
      description: 'Synthetic corrected description',
      approximateSubjects: 30,
    });
    const { result, events } = await as(a, a.member, (tx, context) =>
      handlers.updateBreach({
        tx,
        context,
        input: { ...params(created.id), body: body as never },
      }),
    );

    expect(result).toMatchObject({
      description: 'Synthetic corrected description',
      approximateSubjects: 30,
      becameAwareAt: created.becameAwareAt,
    });
    expect(events).toEqual([
      {
        kind: 'record',
        action: 'privacy.breach.updated',
        entityId: created.id,
        subject: null,
        changes: {
          'privacy.breach.approx_subjects': { before: 12, after: 30 },
          'privacy.breach.description': {},
        },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain('corrected description');
  });

  it('writes nothing when a breach is saved unchanged', async () => {
    const { result: created } = await record(a);
    const body = updateBody();
    const { events } = await as(a, a.member, (tx, context) =>
      handlers.updateBreach({
        tx,
        context,
        input: { ...params(created.id), body: body as never },
      }),
    );

    expect(events).toEqual([]);
  });
});

describe('assessments and notifications', () => {
  it('adds assessments, never changing the earlier ones, with the assessor from the session', async () => {
    const { result: breach } = await record(a);
    const assess = (member: string, riskLevel: string) =>
      as(a, member, (tx, context) =>
        handlers.assessBreach({
          tx,
          context,
          input: {
            ...params(breach.id),
            body: {
              riskLevel,
              notifyIco: false,
              notifySubjects: false,
              rationale: 'Synthetic rationale',
            } as never,
          },
        }),
      );
    const first = await assess(a.member, 'unlikely');
    await assess(a.second, 'risk');

    expect(first.result).toMatchObject({ riskLevel: 'unlikely', assessedByMembershipId: a.member });
    expect(first.events).toEqual([
      {
        kind: 'record',
        action: 'privacy.breach.assessed',
        entityId: breach.id,
        subject: null,
        changes: {
          'privacy.breach_assessment.risk_level': { after: 'unlikely' },
          'privacy.breach_assessment.notify_ico': { after: false },
          'privacy.breach_assessment.notify_subjects': { after: false },
          'privacy.breach_assessment.rationale': {},
        },
      },
    ]);
    expect(JSON.stringify(first.events)).not.toContain('Synthetic rationale');
    const { result } = await as(a, a.member, (tx, context) =>
      handlers.replayBreach({ tx, context, input: params(breach.id), id: null }),
    );
    expect(
      result.assessments.map(({ riskLevel, assessedByMembershipId }) => [
        riskLevel,
        assessedByMembershipId,
      ]),
    ).toEqual([
      ['unlikely', a.member],
      ['risk', a.second],
    ]);
  });

  it('records the ICO notice once, as the session’s member, and needs a reason only when it is late', async () => {
    const { result: breach } = await record(a);
    const tell = (notifiedAt: string, lateReason: string | null, member = a.second) =>
      as(a, member, (tx, context) =>
        handlers.recordIcoNotification({
          tx,
          context,
          input: {
            ...params(breach.id),
            body: { notifiedAt, reference: 'SYN-1', lateReason } as never,
          },
        }),
      );

    expect(await refusal(tell('2026-11-17T09:00:00.000Z', 'other'))).toMatchObject({
      status: 400,
      errors: [{ field: 'body.lateReason' }],
    });
    expect(await refusal(tell('2026-11-16T11:00:00.000Z', null))).toMatchObject({
      status: 400,
      errors: [{ field: 'body.notifiedAt' }],
    });
    expect(await refusal(tell('2026-11-19T00:00:00.000Z', null))).toMatchObject({ status: 400 });

    const told = await tell('2026-11-17T09:00:00.000Z', null);
    expect(told.result.icoNotification).toMatchObject({
      notifiedAt: '2026-11-17T09:00:00.000Z',
      reference: 'SYN-1',
      lateReason: null,
      recordedByMembershipId: a.second,
    });
    expect(told.result.clock.late).toBe(false);
    expect(told.events).toEqual([
      {
        kind: 'record',
        action: 'privacy.breach.ico_notified',
        entityId: breach.id,
        subject: null,
        changes: {
          'privacy.breach.ico_notified_at': { after: '2026-11-17T09:00:00.000Z' },
          'privacy.breach.ico_late_reason': { after: null },
          'privacy.breach.ico_reference': {},
        },
      },
    ]);
    expect(JSON.stringify(told.events)).not.toContain('SYN-1');
    expect(await refusal(tell('2026-11-17T10:00:00.000Z', null))).toMatchObject({ status: 409 });
  });

  it('asks for a late reason when told after 72 hours, and records it', async () => {
    const { result: breach } = await record(a, { becameAwareAt: '2026-11-10T09:00:00.000Z' });
    const { result } = await as(a, a.member, (tx, context) =>
      handlers.recordIcoNotification({
        tx,
        context,
        input: {
          ...params(breach.id),
          body: {
            notifiedAt: '2026-11-15T09:00:00.000Z',
            reference: 'SYN-2',
            lateReason: 'still_investigating',
          },
        },
      }),
    );

    expect(result.icoNotification?.lateReason).toBe('still_investigating');
    expect(result.clock.late).toBe(true);
  });

  it('records telling the people affected once, separately from the ICO', async () => {
    const { result: breach } = await record(a);
    const tell = (notifiedAt: string) =>
      as(a, a.member, (tx, context) =>
        handlers.recordSubjectNotification({
          tx,
          context,
          input: { ...params(breach.id), body: { notifiedAt, method: 'email' } },
        }),
      );

    expect(await refusal(tell('2026-11-19T00:00:00.000Z'))).toMatchObject({ status: 400 });
    const told = await tell('2026-11-17T09:00:00.000Z');

    expect(told.result).toMatchObject({
      icoNotification: null,
      subjectNotification: { method: 'email', recordedByMembershipId: a.member },
    });
    expect(told.events).toEqual([
      {
        kind: 'record',
        action: 'privacy.breach.subjects_notified',
        entityId: breach.id,
        subject: null,
        changes: {
          'privacy.breach.subjects_notified_at': { after: '2026-11-17T09:00:00.000Z' },
          'privacy.breach.subjects_notice_method': { after: 'email' },
        },
      },
    ]);
    expect(await refusal(tell('2026-11-17T10:00:00.000Z'))).toMatchObject({ status: 409 });
  });
});

describe('another tenant', () => {
  it('finds tenant A’s breach missing for every read and action, and changes nothing', async () => {
    const { result: breach } = await record(a);
    const asB = <T>(work: Parameters<typeof as<T>>[2]) => as(b, b.member, work);
    const at = params(breach.id);

    const attempts = [
      () => asB((tx, context) => handlers.getBreach({ tx, context, input: at })),
      () =>
        asB((tx, context) =>
          handlers.updateBreach({ tx, context, input: { ...at, body: updateBody() as never } }),
        ),
      () =>
        asB((tx, context) =>
          handlers.assessBreach({
            tx,
            context,
            input: {
              ...at,
              body: { riskLevel: 'risk', notifyIco: true, notifySubjects: true, rationale: '' },
            },
          }),
        ),
      () =>
        asB((tx, context) =>
          handlers.recordIcoNotification({
            tx,
            context,
            input: {
              ...at,
              body: { notifiedAt: '2026-11-17T09:00:00.000Z', reference: 'SYN', lateReason: null },
            },
          }),
        ),
      () =>
        asB((tx, context) =>
          handlers.recordSubjectNotification({
            tx,
            context,
            input: { ...at, body: { notifiedAt: '2026-11-17T09:00:00.000Z', method: 'post' } },
          }),
        ),
    ];
    for (const attempt of attempts) {
      expect(await refusal(attempt())).toMatchObject({ status: 404 });
    }

    const { result: listed } = await asB((tx, context) =>
      handlers.listBreaches({ tx, context, input: { query: {} } }),
    );
    expect(listed.breaches.map(({ id }) => id)).not.toContain(breach.id);
    const { rows } = await asMigratorIn(a.tenant.id, (client) =>
      client.query<{ ico_notified_at: Date | null; assessments: string }>(
        `SELECT ico_notified_at,
                (SELECT count(*) FROM privacy.breach_assessment WHERE breach_id = $1) AS assessments
           FROM privacy.breach WHERE id = $1`,
        [breach.id],
      ),
    );
    expect(rows[0]).toMatchObject({ ico_notified_at: null, assessments: '0' });
  });
});
