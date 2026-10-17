// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The round routes through the whole API against the test database, as
// app_api: times in the tenant's time zone, the configuration versions and
// the audit log.

import { randomUUID } from 'node:crypto';

import { messages } from '@pixel-scientists/domain/platform';
import { programmeMessages } from '@pixel-scientists/grants/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createTestTenant } from '../../../packages/db/test/tenants.ts';
import {
  answer,
  money,
  programmeBody,
  roundBody,
  rowsOf,
  startProgrammeApi,
  storedVersions,
  type Problem,
  type Programme,
  type ProgrammeApi,
  type Round,
} from './programme-api.ts';
import { addMember, events } from './settings-api.ts';

// Each request runs a few statements in a transaction, which is slow on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

let t: ProgrammeApi;

beforeAll(async () => {
  t = await startProgrammeApi('41011');
}, 60_000);

afterAll(async () => {
  await t.close();
});

const storedTimes = async (tenant: ProgrammeApi['tenantA'], roundId: string) => {
  const [row] = await rowsOf<{ opens_at: Date; closes_at: Date; timezone: string }>(
    tenant,
    'SELECT opens_at, closes_at, timezone FROM grants.round WHERE id = $1',
    [roundId],
  );
  return [row?.opens_at.toISOString(), row?.closes_at.toISOString(), row?.timezone];
};

describe('creating a round', () => {
  it('adds the default stages, stores instants in the tenant’s zone and records the zone', async () => {
    const programme = await t.aProgramme();
    const round = await t.aRound(programme.id);

    expect(round).toEqual({
      id: expect.any(String) as string,
      programmeId: programme.id,
      ...roundBody(),
      timeZone: 'Europe/London',
    });
    expect(await answer(t.send(t.managerA, 'GET', `/console/rounds/${round.id}`))).toEqual(round);
    expect(
      await answer(t.send(t.managerA, 'GET', `/console/programmes/${programme.id}/rounds`)),
    ).toEqual({ rounds: [round] });
    expect(await storedTimes(t.tenantA, round.id)).toEqual([
      '2026-10-20T08:00:00.000Z',
      '2026-11-03T17:00:00.000Z',
      'Europe/London',
    ]);

    const stages = await t.stagesOf(round.id);
    expect(stages.map(({ name, position, criteria }) => [name, position, criteria])).toEqual([
      ['Intake', 1, []],
      ['Review', 2, []],
      ['Decision', 3, []],
    ]);
    const versions = await storedVersions(t.tenantA, 'grants.round', round.id);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ version: 1, author_id: t.managerA.membershipId });
    expect(versions[0]?.diff.changes.map((change) => change.path)).toEqual([
      'title',
      'opensAt',
      'closesAt',
      'timeZone',
      'currency',
      'budget.amountMinor',
      'awardMinimum.amountMinor',
      'awardMaximum.amountMinor',
      'latePolicy',
      ...stages.flatMap((stage) => [`stages.${stage.id}.name`, `stages.${stage.id}.position`]),
    ]);
    expect(versions[0]?.diff.changes.slice(1, 4)).toEqual([
      { path: 'opensAt', from: null, to: '2026-10-20T09:00' },
      { path: 'closesAt', from: null, to: '2026-11-03T17:00' },
      { path: 'timeZone', from: null, to: 'Europe/London' },
    ]);
    const event = (await events(t.tenantA, 'grants.round.created')).find(
      (row) => row.entity_id === round.id,
    );
    expect(event).toMatchObject({
      actor_id: t.managerA.membershipId,
      changes: {
        'grants.round.title': { before: null, after: 'Autumn 2026' },
        'grants.round.timezone': { before: null, after: 'Europe/London' },
        'grants.round.budget_minor': { before: null, after: 5_000_000 },
        'grants.round.late_policy': { before: null, after: 'refuse' },
      },
    });
  });

  it('answers 404 for a programme that is not there', async () => {
    const response = await t.send(
      t.managerA,
      'POST',
      `/console/programmes/${randomUUID()}/rounds`,
      roundBody(),
    );

    expect(response.statusCode).toBe(404);
  });
});

describe('local times', () => {
  it('keep their local times across the clock change on 25 October 2026', async () => {
    const round = await t.aRound((await t.aProgramme()).id, {
      opensAt: '2026-10-24T09:00',
      closesAt: '2026-10-26T09:00',
    });

    expect(round).toMatchObject({ opensAt: '2026-10-24T09:00', closesAt: '2026-10-26T09:00' });
    // 9am is an hour earlier in UTC before the clocks go back than after, so 49 hours pass.
    expect(await storedTimes(t.tenantA, round.id)).toEqual([
      '2026-10-24T08:00:00.000Z',
      '2026-10-26T09:00:00.000Z',
      'Europe/London',
    ]);
    expect(await answer(t.send(t.managerA, 'GET', `/console/rounds/${round.id}`))).toMatchObject({
      opensAt: '2026-10-24T09:00',
      closesAt: '2026-10-26T09:00',
    });

    const moved = await answer<Round>(
      t.send(
        t.managerA,
        'PUT',
        `/console/rounds/${round.id}`,
        roundBody({ opensAt: '2026-10-25T01:30', closesAt: '2026-10-25T09:00' }),
      ),
    );
    // 1:30am happens twice that night, and the round opens the first time.
    expect(moved).toMatchObject({ opensAt: '2026-10-25T01:30', closesAt: '2026-10-25T09:00' });
    expect(await storedTimes(t.tenantA, round.id)).toEqual([
      '2026-10-25T00:30:00.000Z',
      '2026-10-25T09:00:00.000Z',
      'Europe/London',
    ]);
  });

  it('refuse a time the clocks skip, naming the field, and change nothing', async () => {
    const programme = await t.aProgramme();
    const response = await t.send(
      t.managerA,
      'POST',
      `/console/programmes/${programme.id}/rounds`,
      roundBody({ opensAt: '2027-03-28T01:30', closesAt: '2027-04-28T09:00' }),
    );

    expect(response.statusCode).toBe(400);
    expect(response.json<Problem>()).toMatchObject({
      detail: messages.fixFields,
      errors: [{ field: 'body.opensAt', message: messages.enterValidDate }],
    });
    expect(
      await answer(t.send(t.managerA, 'GET', `/console/programmes/${programme.id}/rounds`)),
    ).toEqual({ rounds: [] });
  });

  it('are read in the zone the round was saved in, and saved again in the tenant’s zone of the day', async () => {
    const tenant = await createTestTenant();
    const owner = await addMember(tenant, 'console', 'programme_manager');
    const admin = await addMember(tenant, 'console', 'tenant_admin');
    const programme = await answer<Programme>(
      t.send(owner, 'POST', '/console/programmes', programmeBody()),
      201,
    );
    const times = { opensAt: '2027-02-02T09:00', closesAt: '2027-03-02T09:00' };
    const make = () =>
      answer<Round>(
        t.send(owner, 'POST', `/console/programmes/${programme.id}/rounds`, roundBody(times)),
        201,
      );
    const first = await make();

    await answer(
      t.send(admin, 'PUT', '/console/settings', {
        name: 'Fund',
        timeZone: 'America/New_York',
        fiscalYearStartMonth: 4,
      }),
    );
    const second = await make();

    expect(await answer(t.send(owner, 'GET', `/console/rounds/${first.id}`))).toMatchObject({
      ...times,
      timeZone: 'Europe/London',
    });
    expect(second).toMatchObject({ ...times, timeZone: 'America/New_York' });
    expect((await storedTimes(tenant, first.id))[0]).toBe('2027-02-02T09:00:00.000Z');
    expect((await storedTimes(tenant, second.id))[0]).toBe('2027-02-02T14:00:00.000Z');

    const resaved = await answer<Round>(
      t.send(owner, 'PUT', `/console/rounds/${first.id}`, roundBody(times)),
    );
    expect(resaved.timeZone).toBe('America/New_York');
    expect((await storedTimes(tenant, first.id))[0]).toBe('2027-02-02T14:00:00.000Z');
    expect((await storedVersions(tenant, 'grants.round', first.id))[1]?.diff.changes).toEqual([
      { path: 'timeZone', from: 'Europe/London', to: 'America/New_York' },
    ]);
  });
});

describe('updating a round', () => {
  it('records only what changed, and writes nothing when nothing did', async () => {
    const round = await t.aRound((await t.aProgramme()).id);
    const change = {
      title: 'Autumn 2026, second window',
      awardMaximum: money(3_000_000),
      latePolicy: 'accept_and_flag',
    };

    const updated = await answer<Round>(
      t.send(t.ada, 'PUT', `/console/rounds/${round.id}`, roundBody(change)),
    );
    await answer(t.send(t.ada, 'PUT', `/console/rounds/${round.id}`, roundBody(change)));

    expect(updated).toEqual({ ...round, ...change });
    const versions = await storedVersions(t.tenantA, 'grants.round', round.id);
    expect(versions.map((row) => row.version)).toEqual([1, 2]);
    expect(versions[1]).toMatchObject({ author_id: t.ada.membershipId });
    expect(versions[1]?.diff.changes).toEqual([
      { path: 'title', from: 'Autumn 2026', to: 'Autumn 2026, second window' },
      { path: 'awardMaximum.amountMinor', from: 2_500_000, to: 3_000_000 },
      { path: 'latePolicy', from: 'refuse', to: 'accept_and_flag' },
    ]);
    const updates = (await events(t.tenantA, 'grants.round.updated')).filter(
      (row) => row.entity_id === round.id,
    );
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      actor_id: t.ada.membershipId,
      changes: {
        'grants.round.title': { before: 'Autumn 2026', after: 'Autumn 2026, second window' },
        'grants.round.award_max_minor': { before: 2_500_000, after: 3_000_000 },
        'grants.round.late_policy': { before: 'refuse', after: 'accept_and_flag' },
      },
    });
  });

  it('refuses each check in the contract with its message, and changes nothing', async () => {
    const programme = await t.aProgramme();
    const round = await t.aRound(programme.id);
    const cases: [object, string, string][] = [
      [{ title: '' }, 'body.title', programmeMessages.roundTitle],
      [{ closesAt: '2026-10-20T09:00' }, 'body.closesAt', programmeMessages.closesAfterOpens],
      [{ closesAt: '2026-10-19T09:00' }, 'body.closesAt', programmeMessages.closesAfterOpens],
      [{ opensAt: '2026-10-20' }, 'body.opensAt', messages.enterValidDate],
      [{ opensAt: '2026-10-20T09:00Z' }, 'body.opensAt', messages.enterValidDate],
      [{ closesAt: '2026-02-30T09:00' }, 'body.closesAt', messages.enterValidDate],
      [{ awardMaximum: money(50_000) }, 'body.awardMaximum', programmeMessages.awardMaximum],
      [{ budget: money(2_000_000) }, 'body.budget', programmeMessages.budget],
      [{ budget: money(0) }, 'body.budget.amountMinor', programmeMessages.amountPositive],
      [
        { awardMinimum: money(-5) },
        'body.awardMinimum.amountMinor',
        programmeMessages.amountPositive,
      ],
      [
        { budget: money(100_000_000_001) },
        'body.budget.amountMinor',
        programmeMessages.amountTooLarge,
      ],
      [
        { budget: { amountMinor: 5_000_000, currency: 'USD' } },
        'body.budget.currency',
        messages.currency,
      ],
      [{ latePolicy: 'whenever' }, 'body.latePolicy', ''],
      [{ timeZone: 'Asia/Tokyo' }, 'body.timeZone', ''],
    ];
    for (const [change, field, message] of cases) {
      for (const [method, url] of [
        ['POST', `/console/programmes/${programme.id}/rounds`],
        ['PUT', `/console/rounds/${round.id}`],
      ] as const) {
        const response = await t.send(t.managerA, method, url, roundBody(change));
        expect(response.statusCode, JSON.stringify(change)).toBe(400);
        const found = response.json<Problem>().errors?.find((error) => error.field === field);
        expect(found, `${field} for ${JSON.stringify(change)}`).toBeDefined();
        if (message !== '') expect(found?.message).toBe(message);
      }
    }
    expect(await answer(t.send(t.managerA, 'GET', `/console/rounds/${round.id}`))).toEqual(round);
    expect(await storedVersions(t.tenantA, 'grants.round', round.id)).toHaveLength(1);
    expect(
      await answer(t.send(t.managerA, 'GET', `/console/programmes/${programme.id}/rounds`)),
    ).toEqual({ rounds: [round] });
  });
});
