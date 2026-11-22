// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The processing activity and processor routes' handlers against the test
// database, as app_api in a tenant's transaction: codes and links checked,
// audit events with ids and codes and never a name, a replayed create, and
// tenant B unable to read or change tenant A's records. Permission and
// module-off answers are the platform's, in front of these handlers. The
// tables' own cross-tenant denial is in packages/db/test/privacy.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

const NAME = 'Synthetic grant administration';
const PURPOSE = 'Synthetic purpose of the processing';

const activity = (change: Record<string, unknown> = {}) =>
  ({
    name: NAME,
    purpose: PURPOSE,
    legalBasis: 'public_task',
    specialCategoryCondition: null,
    dataCategories: ['identity', 'contact'],
    subjectCategories: ['applicants'],
    recipients: 'Synthetic panel',
    processorIds: [],
    transfersAbroad: '',
    retention: 'Six years after the grant ends',
    securityMeasures: 'Synthetic measures',
    ...change,
  }) as never;

const processor = (change: Record<string, unknown> = {}) =>
  ({
    name: 'Synthetic hosting provider',
    service: 'Synthetic hosting',
    countryCode: 'GB',
    contractSignedOn: '2026-01-31',
    transferSafeguard: null,
    ...change,
  }) as never;

let a: Fixture;
let b: Fixture;

beforeAll(async () => {
  openDatabase();
  a = await addFixture();
  b = await addFixture();
}, 60_000);

afterAll(closeDatabase);

const addActivity = (fixture: Fixture, change: Record<string, unknown> = {}) =>
  as(fixture, fixture.member, (tx, context) =>
    handlers.createProcessingActivity({ tx, context, input: { body: activity(change) } }),
  );

const addProcessor = (fixture: Fixture, change: Record<string, unknown> = {}) =>
  as(fixture, fixture.member, (tx, context) =>
    handlers.createProcessor({ tx, context, input: { body: processor(change) } }),
  );

describe('the generated record', () => {
  it('is read by anyone the platform admits, with no tenant data and no audit event', async () => {
    const { result, events } = await as(a, a.member, () => handlers.getProcessingRecord());
    expect(result.tables.length).toBeGreaterThan(100);
    expect(Date.parse(result.generatedAt)).not.toBeNaN();
    expect(events).toEqual([]);
  });
});

describe('processing activities', () => {
  it('adds one with its processors, by the session member, and audits codes and ids only', async () => {
    const { result: hosting } = await addProcessor(a);
    const { result, events } = await addActivity(a, {
      name: 'Synthetic activity one',
      processorIds: [hosting.id],
      specialCategoryCondition: 'substantial_public_interest',
    });

    expect(result).toMatchObject({
      name: 'Synthetic activity one',
      legalBasis: 'public_task',
      processorIds: [hosting.id],
      dataCategories: ['identity', 'contact'],
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'record',
      action: 'privacy.processing_activity.changed',
      entityId: result.id,
      subject: null,
    });
    const serialised = JSON.stringify(events);
    for (const text of ['Synthetic activity one', PURPOSE, 'Synthetic panel']) {
      expect(serialised).not.toContain(text);
    }
  });

  it('changes one, naming the codes that changed and the text columns by name only', async () => {
    const { result: created } = await addActivity(a, { name: 'Synthetic activity two' });
    const { result: processor } = await addProcessor(a, { name: 'Synthetic mail provider' });

    const { result, events } = await as(a, a.member, (tx, context) =>
      handlers.updateProcessingActivity({
        tx,
        context,
        input: {
          params: { activityId: created.id },
          body: activity({
            name: 'Synthetic activity two',
            purpose: 'A different synthetic purpose',
            legalBasis: 'contract',
            processorIds: [processor.id],
          }),
        },
      }),
    );

    expect(result).toMatchObject({ legalBasis: 'contract', processorIds: [processor.id] });
    expect(events).toHaveLength(1);
    expect(events[0]?.changes).toEqual({
      'privacy.processing_activity.legal_basis': { before: 'public_task', after: 'contract' },
      'privacy.processing_activity.purpose': {},
      'privacy.processing_activity_processor.processor_id': { before: [], after: [processor.id] },
    });
    expect(JSON.stringify(events)).not.toContain('A different synthetic purpose');
  });

  it('writes nothing when nothing changed', async () => {
    const { result: created } = await addActivity(a, { name: 'Synthetic activity three' });
    const { events } = await as(a, a.member, (tx, context) =>
      handlers.updateProcessingActivity({
        tx,
        context,
        input: {
          params: { activityId: created.id },
          body: activity({ name: 'Synthetic activity three' }),
        },
      }),
    );
    expect(events).toEqual([]);
  });

  it('refuses a name already in use, and a processor from another tenant, echoing neither', async () => {
    await addActivity(a, { name: 'Synthetic activity four' });
    const duplicate = await refusal(addActivity(a, { name: 'synthetic ACTIVITY four' }));
    expect(duplicate).toMatchObject({ status: 409 });
    expect(duplicate.message).not.toContain('activity four');

    const { result: theirs } = await addProcessor(b);
    const foreign = await refusal(
      addActivity(a, { name: 'Synthetic activity five', processorIds: [theirs.id] }),
    );
    expect(foreign.status).toBe(400);
    expect(foreign.message).not.toContain(theirs.id);
    expect(foreign.errors).toEqual([{ field: 'body.processorIds', message: foreign.message }]);
  });

  it('lists a page at a time and refuses a cursor it did not give', async () => {
    const { result } = await as(a, a.member, (tx, context) =>
      handlers.listProcessingActivities({ tx, context, input: { query: {} } }),
    );
    expect(result.activities.length).toBeGreaterThan(0);
    expect(result.nextCursor).toBeNull();

    const refused = await refusal(
      as(a, a.member, (tx, context) =>
        handlers.listProcessingActivities({ tx, context, input: { query: { cursor: 'AAAA' } } }),
      ),
    );
    expect(refused.status).toBe(400);
  });

  it('answers a replayed create with the first record, and a missing one with 404', async () => {
    const { result: created } = await addActivity(a, { name: 'Synthetic activity six' });
    const { result, events } = await as(a, a.member, (tx, context) =>
      handlers.replayActivity({ tx, context, input: undefined, id: created.id }),
    );
    expect(result).toEqual(created);
    expect(events).toEqual([]);
    const missing = as(a, a.member, (tx, context) =>
      handlers.replayActivity({ tx, context, input: undefined, id: null }),
    );
    expect((await refusal(missing)).status).toBe(404);
  });

  it("does not show tenant A's activities to tenant B, nor let B read or change one", async () => {
    const { result: mine } = await addActivity(a, { name: 'Synthetic activity seven' });

    const listed = await as(b, b.member, (tx, context) =>
      handlers.listProcessingActivities({ tx, context, input: { query: {} } }),
    );
    expect(listed.result.activities.map(({ id }) => id)).not.toContain(mine.id);

    for (const id of [mine.id, unknownId()]) {
      const read = as(b, b.member, (tx, context) =>
        handlers.getProcessingActivity({ tx, context, input: { params: { activityId: id } } }),
      );
      expect((await refusal(read)).status).toBe(404);
      const change = as(b, b.member, (tx, context) =>
        handlers.updateProcessingActivity({
          tx,
          context,
          input: { params: { activityId: id }, body: activity() },
        }),
      );
      const refused = await refusal(change);
      expect(refused.status).toBe(404);
      expect(refused.message).not.toContain(id);
    }
    const unchanged = await as(a, a.member, (tx, context) =>
      handlers.getProcessingActivity({ tx, context, input: { params: { activityId: mine.id } } }),
    );
    expect(unchanged.result.name).toBe('Synthetic activity seven');
  });
});

describe('processors', () => {
  it('adds and changes one, auditing codes and dates and never the name or service', async () => {
    const { result: created, events: added } = await addProcessor(a, {
      name: 'Synthetic backup provider',
      transferSafeguard: 'uk_addendum',
      countryCode: 'US',
    });
    expect(created).toMatchObject({ countryCode: 'US', contractSignedOn: '2026-01-31' });
    expect(added[0]).toMatchObject({ action: 'privacy.processor.changed', entityId: created.id });

    const { result, events } = await as(a, a.member, (tx, context) =>
      handlers.updateProcessor({
        tx,
        context,
        input: {
          params: { processorId: created.id },
          body: processor({
            name: 'Synthetic backup provider',
            service: 'A different synthetic service',
            countryCode: 'GB',
            transferSafeguard: null,
          }),
        },
      }),
    );
    expect(result).toMatchObject({ countryCode: 'GB', transferSafeguard: null });
    expect(events[0]?.changes).toEqual({
      'privacy.processor.country_code': { before: 'US', after: 'GB' },
      'privacy.processor.transfer_safeguard': { before: 'uk_addendum', after: null },
      'privacy.processor.service': {},
    });
    expect(JSON.stringify([added, events])).not.toContain('Synthetic backup provider');
  });

  it('answers a replayed create with the first record', async () => {
    const { result: created } = await addProcessor(a, { name: 'Synthetic scanning provider' });
    const { result } = await as(a, a.member, (tx, context) =>
      handlers.replayProcessor({ tx, context, input: undefined, id: created.id }),
    );
    expect(result).toEqual(created);
  });

  it("keeps tenant A's processors from tenant B", async () => {
    const { result: mine } = await addProcessor(a, { name: 'Synthetic private provider' });
    const listed = await as(b, b.member, (tx, context) =>
      handlers.listProcessors({ tx, context, input: { query: {} } }),
    );
    expect(listed.result.processors.map(({ id }) => id)).not.toContain(mine.id);

    const change = as(b, b.member, (tx, context) =>
      handlers.updateProcessor({
        tx,
        context,
        input: { params: { processorId: mine.id }, body: processor() },
      }),
    );
    const refused = await refusal(change);
    expect(refused.status).toBe(404);
    expect(refused.message).not.toContain(mine.id);
  });
});
