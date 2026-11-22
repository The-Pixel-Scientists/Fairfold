// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The DPIA register's handlers against the test database, as app_api in a
// tenant's transaction: screening answers and risks stored by stable id,
// links only to the tenant's own processing activities, sign-off by the
// session's member at a database time, reopening through a change, text that
// never reaches an audit event, and tenant B unable to reach tenant A's
// DPIAs.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { activityRow } from '../../../../../packages/db/test/privacy/fixtures.ts';
import { asMigratorIn, insertRow } from '../../../../../packages/db/test/tenants.ts';
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

const ADVICE = 'Synthetic advice from the data protection officer';

const input = (change: Record<string, unknown> = {}) => ({
  title: 'Synthetic DPIA',
  processingActivityIds: [] as string[],
  screening: { q_children: 'no', q_scale: 'yes' },
  risks: [
    {
      id: 'r_leak',
      description: 'Synthetic risk of a leak',
      likelihood: 'possible',
      severity: 'significant',
      mitigation: 'Synthetic mitigation',
    },
  ],
  dpoAdvice: ADVICE,
  ...change,
});

let a: Fixture;
let b: Fixture;
let activity: string;
let otherActivity: string;

async function addActivity(fixture: Fixture): Promise<string> {
  return asMigratorIn(fixture.tenant.id, (client) =>
    insertRow(client, 'privacy.processing_activity', activityRow(fixture.tenant, fixture.member)),
  );
}

beforeAll(async () => {
  openDatabase();
  a = await addFixture();
  b = await addFixture();
  activity = await addActivity(a);
  otherActivity = await addActivity(b);
}, 60_000);

afterAll(closeDatabase);

const create = (fixture: Fixture, change: Record<string, unknown> = {}) =>
  as(fixture, fixture.member, (tx, context) =>
    handlers.createDpia({ tx, context, input: { body: input(change) as never } }),
  );

const update = (fixture: Fixture, dpiaId: string, change: Record<string, unknown> = {}) =>
  as(fixture, fixture.member, (tx, context) =>
    handlers.updateDpia({
      tx,
      context,
      input: { params: { dpiaId }, body: { ...input(), status: 'in_review', ...change } as never },
    }),
  );

const signOff = (fixture: Fixture, dpiaId: string, member: string, reviewOn = '2027-11-18') =>
  as(fixture, member, (tx, context) =>
    handlers.signOffDpia({ tx, context, input: { params: { dpiaId }, body: { reviewOn } } }),
  );

describe('createDpia and getDpia', () => {
  it('starts a draft with its answers and risks by stable id, linked to the tenant’s activities, and audits no text', async () => {
    const { result, events } = await create(a, { processingActivityIds: [activity] });

    expect(result).toMatchObject({
      status: 'draft',
      processingActivityIds: [activity],
      screening: { q_children: 'no', q_scale: 'yes' },
      risks: [{ id: 'r_leak', likelihood: 'possible' }],
      signOff: null,
    });
    expect(events).toEqual([
      {
        kind: 'record',
        action: 'privacy.dpia.created',
        entityId: result.id,
        subject: null,
        changes: {
          'privacy.dpia.title': { after: 'Synthetic DPIA' },
          'privacy.dpia.status': { after: 'draft' },
        },
      },
    ]);
    expect(JSON.stringify(events)).not.toMatch(/Synthetic (risk|advice|mitigation)/);

    const read = await as(a, a.second, (tx, context) =>
      handlers.getDpia({ tx, context, input: { params: { dpiaId: result.id } } }),
    );
    expect(read.result.dpoAdvice).toBe(ADVICE);
    expect(read.events).toEqual([
      { kind: 'read', action: 'privacy.dpia.viewed', entityId: result.id, subject: null },
    ]);
  });

  it('refuses an activity that is missing or another tenant’s, naming the field and echoing no id', async () => {
    for (const id of [otherActivity, unknownId()]) {
      const refused = await refusal(create(a, { processingActivityIds: [id] }));

      expect(refused).toMatchObject({
        status: 400,
        errors: [{ field: 'body.processingActivityIds' }],
      });
      expect(JSON.stringify([refused.message, refused.errors])).not.toContain(id);
    }
  });

  it('refuses answers and risks the database size cap would refuse, with a plain message', async () => {
    const risks = Array.from({ length: 50 }, (_, index) => ({
      id: `r_${String(index)}`,
      description: 'x'.repeat(2000),
      likelihood: 'remote',
      severity: 'minimal',
      mitigation: 'y'.repeat(2000),
    }));

    expect(await refusal(create(a, { risks }))).toMatchObject({
      status: 400,
      message: 'The screening answers or risks are too long. Shorten them and try again.',
    });
  });

  it('lists by status with the review date', async () => {
    const fixture = await addFixture();
    const draft = (await create(fixture)).result;
    const signed = (await create(fixture)).result;
    await signOff(fixture, signed.id, fixture.member);

    const list = (query: Record<string, string>) =>
      as(fixture, fixture.member, (tx, context) =>
        handlers.listDpias({ tx, context, input: { query } }),
      ).then(({ result }) => result.dpias);
    expect((await list({ status: 'draft' })).map(({ id }) => id)).toEqual([draft.id]);
    expect(await list({ status: 'signed_off' })).toEqual([
      expect.objectContaining({ id: signed.id, reviewOn: '2027-11-18' }),
    ]);
    expect(await list({})).toHaveLength(2);
    expect(await refusal(list({ cursor: '!' }))).toMatchObject({ status: 400 });
  });
});

describe('updateDpia', () => {
  it('changes the content and the links, auditing only what changed and never the text', async () => {
    const { result: created } = await create(a, { processingActivityIds: [activity] });
    const { result, events } = await update(a, created.id, {
      title: 'Synthetic new title',
      processingActivityIds: [],
      dpoAdvice: 'Synthetic new advice',
    });

    expect(result).toMatchObject({
      title: 'Synthetic new title',
      status: 'in_review',
      processingActivityIds: [],
    });
    expect(events).toEqual([
      {
        kind: 'record',
        action: 'privacy.dpia.updated',
        entityId: created.id,
        subject: null,
        changes: {
          'privacy.dpia.status': { before: 'draft', after: 'in_review' },
          'privacy.dpia.title': {},
          'privacy.dpia.dpo_advice': {},
          'privacy.dpia_processing_activity.processing_activity_id': {},
        },
      },
    ]);
    expect(JSON.stringify(events)).not.toMatch(/Synthetic new/);
  });

  it('names the screening answers and risks as changed without their content, and writes nothing for no change', async () => {
    const { result: created } = await create(a);
    const unchanged = await update(a, created.id, { status: 'draft' });
    const changed = await update(a, created.id, {
      status: 'draft',
      screening: { q_children: 'yes', q_scale: 'yes' },
      risks: [],
    });

    expect(unchanged.events).toEqual([]);
    expect(changed.events[0]?.changes).toEqual({
      'privacy.dpia.screening': {},
      'privacy.dpia.risks': {},
    });
    expect(changed.result.screening).toEqual({ q_children: 'yes', q_scale: 'yes' });
  });
});

describe('signOffDpia', () => {
  it('signs off as the session’s member at the database’s time, and refuses a second sign-off', async () => {
    const { result: created } = await create(a, { processingActivityIds: [activity] });

    const { result, events } = await signOff(a, created.id, a.second);
    expect(result.status).toBe('signed_off');
    expect(result.signOff).toMatchObject({ membershipId: a.second, reviewOn: '2027-11-18' });
    expect(result.signOff?.signedOffAt).toEqual(expect.any(String));
    expect(events).toEqual([
      {
        kind: 'record',
        action: 'privacy.dpia.signed_off',
        entityId: created.id,
        subject: null,
        changes: {
          'privacy.dpia.status': { before: 'draft', after: 'signed_off' },
          'privacy.dpia.review_on': { after: '2027-11-18' },
        },
      },
    ]);
    expect(await refusal(signOff(a, created.id, a.member))).toMatchObject({ status: 409 });
  });

  it('refuses a review date that is not after today', async () => {
    const { result: created } = await create(a);

    expect(await refusal(signOff(a, created.id, a.member, '2026-11-18'))).toMatchObject({
      status: 400,
      errors: [{ field: 'body.reviewOn' }],
    });
  });

  it('reopens a signed-off DPIA through a change to draft or in review, which clears the sign-off, and the activities then change', async () => {
    const { result: created } = await create(a, { processingActivityIds: [activity] });
    await signOff(a, created.id, a.member);

    const { result, events } = await update(a, created.id, { processingActivityIds: [] });

    expect(result).toMatchObject({ status: 'in_review', signOff: null, processingActivityIds: [] });
    expect(events[0]?.changes).toEqual({
      'privacy.dpia.status': { before: 'signed_off', after: 'in_review' },
      'privacy.dpia_processing_activity.processing_activity_id': {},
      'privacy.dpia.signed_off_by': { before: a.member },
    });
  });
});

describe('another tenant', () => {
  it('finds tenant A’s DPIA missing for every read and action, and changes nothing', async () => {
    const { result: created } = await create(a, { processingActivityIds: [activity] });
    const asB = <T>(work: Parameters<typeof as<T>>[2]) => as(b, b.member, work);
    const params = { dpiaId: created.id };

    const attempts = [
      () => asB((tx, context) => handlers.getDpia({ tx, context, input: { params } })),
      () => update(b, created.id),
      () => signOff(b, created.id, b.member),
    ];
    for (const attempt of attempts) {
      expect(await refusal(attempt())).toMatchObject({ status: 404 });
    }

    const { result: listed } = await asB((tx, context) =>
      handlers.listDpias({ tx, context, input: { query: {} } }),
    );
    expect(listed.dpias.map(({ id }) => id)).not.toContain(created.id);
    const { result: untouched } = await as(a, a.member, (tx, context) =>
      handlers.replayDpia({ tx, context, input: { params }, id: null }),
    );
    expect(untouched).toMatchObject({ status: 'draft', processingActivityIds: [activity] });
  });
});
