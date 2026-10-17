// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The programme routes through the whole API against the test database, as
// app_api: sessions, the policy, row-level security, the configuration
// versions and the audit log, for several tenants. Rounds, stages and
// rubrics are in rounds.integration.test.ts and stages.integration.test.ts,
// and the email templates in programme-templates.integration.test.ts.

import { randomUUID } from 'node:crypto';

import { defaultEmailTemplates, programmeMessages } from '@pixel-scientists/grants/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { asMigratorIn, createTestTenant, insertRow } from '../../../packages/db/test/tenants.ts';
import {
  answer,
  everyRoute,
  programmeBody,
  rowsOf,
  startProgrammeApi,
  storedVersions,
  roundBody,
  type Problem,
  type Programme,
  type ProgrammeApi,
  type Round,
  type Stage,
} from './programme-api.ts';
import { addMember, events } from './settings-api.ts';
import { expectLooksMissing } from './support.ts';

// Each request runs a few statements in a transaction, which is slow on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

let t: ProgrammeApi;

beforeAll(async () => {
  t = await startProgrammeApi('41010');
}, 60_000);

afterAll(async () => {
  await t.close();
});

describe('who may use the programme routes', () => {
  it('refuse a reviewer, an administrator, an applicant and a signed-out caller, and change nothing', async () => {
    const programme = await t.aProgramme();
    const round = await t.aRound(programme.id);
    const [stage] = await t.stagesOf(round.id);
    const count = () => rowsOf(t.tenantA, 'SELECT count(*)::int AS n FROM app.config_version');
    const before = await count();

    for (const [method, url, body] of everyRoute(programme.id, round.id, stage?.id ?? '')) {
      for (const member of [t.reviewerA, t.adminA]) {
        const response = await t.send(member, method, url, body);
        expect(response.statusCode, `${method} ${url}`).toBe(403);
        expect(response.json<Problem>().detail).toBe('You do not have permission to do this.');
      }
      const applicant = await t.send(t.applicantA, method, url, body);
      expect(applicant.statusCode, `${method} ${url} as an applicant`).toBe(403);
      const inPortal = await t.send(t.managerA, method, url, body, 'portal');
      expect(inPortal.statusCode, `${method} ${url} in the portal`).toBe(403);
      const signedOut = await t.send(undefined, method, url, body);
      expect(signedOut.statusCode, `${method} ${url} signed out`).toBe(401);
    }

    expect(await count()).toEqual(before);
    expect(await t.stagesOf(round.id)).toHaveLength(3);
  });
});

describe('another tenant’s records', () => {
  it('read as missing on every route that takes an id, and nothing of theirs changes', async () => {
    const programme = await t.aProgramme({ title: 'Tenant A only' });
    const round = await t.aRound(programme.id);
    const [stage] = await t.stagesOf(round.id);
    const ids = [programme.id, round.id, stage?.id ?? ''] as const;
    const unknown = [randomUUID(), randomUUID(), randomUUID()] as const;
    const real = everyRoute(...ids);
    const absent = everyRoute(...unknown);

    let withId = 0;
    for (const [index, [method, url, body]] of real.entries()) {
      if (!ids.some((id) => url.includes(id))) continue;
      withId += 1;
      const outside = await t.send(t.managerB, method, url, body);
      const missing = await t.send(t.managerB, method, absent[index]?.[1] ?? '', body);
      expect(outside.statusCode, `${method} ${url}`).toBe(404);
      expectLooksMissing(outside, missing);
    }

    expect(withId).toBe(13);
    const list = await answer<{ programmes: Programme[] }>(
      t.send(t.managerB, 'GET', '/console/programmes'),
    );
    expect(list.programmes).toEqual([]);
    expect(await t.stagesOf(round.id)).toHaveLength(3);
    expect(await storedVersions(t.tenantA, 'grants.round', round.id)).toHaveLength(1);
    expect(await storedVersions(t.tenantB, 'grants.round', round.id)).toEqual([]);
  });

  it('read as missing when a body names another tenant’s stage', async () => {
    const mine = await t.aRound((await t.aProgramme()).id);
    const theirs = await answer<Programme>(
      t.send(t.managerB, 'POST', '/console/programmes', programmeBody()),
      201,
    );
    const theirRound = await answer<Round>(
      t.send(t.managerB, 'POST', `/console/programmes/${theirs.id}/rounds`, roundBody()),
      201,
    );
    const foreign = await answer<{ stages: Stage[] }>(
      t.send(t.managerB, 'GET', `/console/rounds/${theirRound.id}/stages`),
    );

    const response = await t.send(t.managerA, 'PUT', `/console/rounds/${mine.id}/stages`, {
      stages: [{ id: foreign.stages[0]?.id, name: 'Intake' }],
    });

    expect(response.statusCode).toBe(404);
    expect((await t.stagesOf(mine.id)).map((stage) => stage.name)).toEqual([
      'Intake',
      'Review',
      'Decision',
    ]);
  });
});

describe('programmes', () => {
  it('creates a programme as a draft, with a version, an audit event and the default templates', async () => {
    const created = await answer<Programme>(
      t.send(t.managerA, 'POST', '/console/programmes', {
        title: '  Climate Fund ',
        summary: 'For climate projects.',
      }),
      201,
    );

    expect(created).toEqual({
      id: expect.any(String) as string,
      title: 'Climate Fund',
      summary: 'For climate projects.',
      description: '',
      status: 'draft',
    });
    expect(await answer(t.send(t.managerA, 'GET', `/console/programmes/${created.id}`))).toEqual(
      created,
    );

    const versions = await storedVersions(t.tenantA, 'grants.programme', created.id);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ version: 1, author_id: t.managerA.membershipId });
    expect(versions[0]?.diff.changes).toEqual([
      { path: 'title', from: null, to: 'Climate Fund' },
      { path: 'summary', from: null, to: 'For climate projects.' },
      { path: 'description', from: null, to: '' },
      { path: 'status', from: null, to: 'draft' },
      ...(['accepted', 'waitlisted', 'declined'] as const).flatMap((outcome) => [
        {
          path: `emailTemplates.${outcome}.subject`,
          from: null,
          to: defaultEmailTemplates[outcome].subject,
        },
        {
          path: `emailTemplates.${outcome}.body`,
          from: null,
          to: defaultEmailTemplates[outcome].body,
        },
      ]),
    ]);

    expect(
      await rowsOf(
        t.tenantA,
        `SELECT outcome, version, subject, body, created_by FROM grants.email_template_version
          WHERE programme_id = $1 ORDER BY outcome`,
        [created.id],
      ),
    ).toEqual(
      (['accepted', 'declined', 'waitlisted'] as const).map((outcome) => ({
        outcome,
        version: 1,
        ...defaultEmailTemplates[outcome],
        created_by: t.managerA.membershipId,
      })),
    );
    const event = (await events(t.tenantA, 'grants.programme.created')).find(
      (row) => row.entity_id === created.id,
    );
    expect(event).toMatchObject({
      actor_id: t.managerA.membershipId,
      changes: {
        'grants.programme.title': { before: null, after: 'Climate Fund' },
        'grants.programme.status': { before: null, after: 'draft' },
      },
    });
  });

  it('lists programmes by title, each with its rounds, the latest opening first', async () => {
    const tenant = await createTestTenant();
    const owner = await addMember(tenant, 'console', 'programme_manager');
    const make = (title: string) =>
      answer<Programme>(
        t.send(owner, 'POST', '/console/programmes', programmeBody({ title })),
        201,
      );
    const [zebra, apple] = [await make('zebra Fund'), await make('Apple Fund')];
    const open = (opensAt: string, closesAt: string) =>
      answer<Round>(
        t.send(
          owner,
          'POST',
          `/console/programmes/${apple.id}/rounds`,
          roundBody({ opensAt, closesAt }),
        ),
        201,
      );
    const early = await open('2027-01-04T09:00', '2027-02-01T09:00');
    const late = await open('2027-06-07T09:00', '2027-07-01T09:00');

    const list = await answer<{
      programmes: (Omit<Programme, 'description'> & { rounds: Round[] })[];
    }>(t.send(owner, 'GET', '/console/programmes'));

    expect(list.programmes.map((programme) => programme.title)).toEqual([
      'Apple Fund',
      'zebra Fund',
    ]);
    expect(list.programmes[0]?.rounds).toEqual([late, early]);
    expect(list.programmes[1]).toEqual({
      id: zebra.id,
      title: 'zebra Fund',
      summary: zebra.summary,
      status: 'draft',
      rounds: [],
    });
  });

  it('updates a programme, recording only what changed, and writes nothing when nothing did', async () => {
    const programme = await t.aProgramme();
    const change = { summary: 'Money for shared spaces.', status: 'open' };

    const changed = await answer<Programme>(
      t.send(t.ada, 'PUT', `/console/programmes/${programme.id}`, programmeBody(change)),
    );
    await answer(
      t.send(t.managerA, 'PUT', `/console/programmes/${programme.id}`, programmeBody(change)),
    );

    expect(changed).toEqual({ ...programme, ...change });
    const versions = await storedVersions(t.tenantA, 'grants.programme', programme.id);
    expect(versions.map((row) => row.version)).toEqual([1, 2]);
    expect(versions[1]).toMatchObject({ author_id: t.ada.membershipId });
    expect(versions[1]?.diff.changes).toEqual([
      { path: 'summary', from: programme.summary, to: 'Money for shared spaces.' },
      { path: 'status', from: 'draft', to: 'open' },
    ]);
    const updates = (await events(t.tenantA, 'grants.programme.updated')).filter(
      (row) => row.entity_id === programme.id,
    );
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      actor_id: t.ada.membershipId,
      changes: {
        'grants.programme.summary': {
          before: programme.summary,
          after: 'Money for shared spaces.',
        },
        'grants.programme.status': { before: 'draft', after: 'open' },
      },
    });
  });

  it('refuses a title, a summary, hidden characters, a status and keys the contract does not have', async () => {
    const programme = await t.aProgramme();
    const cases: [object, string, string | undefined][] = [
      [{ title: '   ' }, 'body.title', programmeMessages.programmeTitle],
      [{ title: 'x'.repeat(121) }, 'body.title', undefined],
      [{ summary: '' }, 'body.summary', programmeMessages.programmeSummary],
      [{ title: 'Fund‮evil' }, 'body.title', programmeMessages.hiddenCharacters],
      [{ description: 'Fund\u0000' }, 'body.description', programmeMessages.hiddenCharactersText],
      [{ status: 'archived' }, 'body.status', undefined],
      [{ tenantId: t.tenantB.id }, 'body.tenantId', undefined],
      [{ createdBy: t.ada.membershipId }, 'body.createdBy', undefined],
    ];
    for (const [change, field, message] of cases) {
      for (const [method, url] of [
        ['POST', '/console/programmes'],
        ['PUT', `/console/programmes/${programme.id}`],
      ] as const) {
        const response = await t.send(t.managerA, method, url, programmeBody(change));
        expect(response.statusCode, JSON.stringify(change)).toBe(400);
        const found = response.json<Problem>().errors?.find((error) => error.field === field);
        expect(found, `${field} for ${JSON.stringify(change)}`).toBeDefined();
        if (message !== undefined) expect(found?.message).toBe(message);
      }
    }
    expect(await answer(t.send(t.managerA, 'GET', `/console/programmes/${programme.id}`))).toEqual(
      programme,
    );
  });
});

describe('configuration history', () => {
  it('lists an object’s versions newest first, naming each author from their person record when they have one', async () => {
    const programme = await t.aProgramme();
    await answer(
      t.send(
        t.ada,
        'PUT',
        `/console/programmes/${programme.id}`,
        programmeBody({ status: 'open' }),
      ),
    );

    const history = await answer<{
      versions: {
        version: number;
        createdAt: string;
        author: { membershipId: string; name: string | null };
        changes: unknown[];
      }[];
    }>(t.send(t.managerA, 'GET', `/console/programmes/${programme.id}/history`));

    expect(history.versions.map((version) => version.version)).toEqual([2, 1]);
    expect(history.versions[0]).toEqual({
      version: 2,
      createdAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT[\d:.]+Z$/) as string,
      author: { membershipId: t.ada.membershipId, name: 'Ada Lovelace' },
      changes: [{ path: 'status', from: 'draft', to: 'open' }],
    });
    expect(history.versions[1]?.author).toEqual({
      membershipId: t.managerA.membershipId,
      name: null,
    });
    expect(history.versions[1]?.changes).toHaveLength(10);
  });

  it('gives a round’s history with its stages and rubrics, and keeps it from other tenants', async () => {
    const round = await t.aRound((await t.aProgramme()).id);
    const [, review] = await t.stagesOf(round.id);
    await answer(
      t.send(t.ada, 'PUT', `/console/stages/${review?.id}/rubric`, {
        criteria: [{ label: 'Need', weight: 2 }],
      }),
    );
    await answer(
      t.send(t.ada, 'PUT', `/console/rounds/${round.id}`, roundBody({ title: 'Renamed' })),
    );

    const history = await answer<{
      versions: { version: number; author: { name: string | null }; changes: { path: string }[] }[];
    }>(t.send(t.managerA, 'GET', `/console/rounds/${round.id}/history`));

    expect(history.versions.map((version) => [version.version, version.author.name])).toEqual([
      [3, 'Ada Lovelace'],
      [2, 'Ada Lovelace'],
      [1, null],
    ]);
    expect(history.versions[0]?.changes.map((change) => change.path)).toEqual(['title']);
    expect(
      history.versions[1]?.changes.every((change) =>
        change.path.startsWith(`stages.${review?.id}.criteria.`),
      ),
    ).toBe(true);
    expect(
      (await t.send(t.managerB, 'GET', `/console/rounds/${round.id}/history`)).statusCode,
    ).toBe(404);
  });

  it('keeps a programme’s versions apart from its rounds’', async () => {
    const programme = await t.aProgramme();
    const round = await t.aRound(programme.id);

    const history = await answer<{ versions: unknown[] }>(
      t.send(t.managerA, 'GET', `/console/programmes/${programme.id}/history`),
    );

    expect(history.versions).toHaveLength(1);
    expect(await storedVersions(t.tenantA, 'grants.round', round.id)).toHaveLength(1);
  });
});

describe('the module switch', () => {
  it('answers 404 on every route for a tenant with grants switched off, and for that tenant only', async () => {
    const tenant = await createTestTenant();
    const owner = await addMember(tenant, 'console', 'programme_manager');
    const programme = await answer<Programme>(
      t.send(owner, 'POST', '/console/programmes', programmeBody()),
      201,
    );
    const round = await answer<Round>(
      t.send(owner, 'POST', `/console/programmes/${programme.id}/rounds`, roundBody()),
      201,
    );
    const { stages } = await answer<{ stages: Stage[] }>(
      t.send(owner, 'GET', `/console/rounds/${round.id}/stages`),
    );
    const routes = everyRoute(programme.id, round.id, stages[0]?.id ?? '');
    expect(routes).toHaveLength(15);
    expect((await t.send(owner, 'GET', `/console/rounds/${round.id}`)).statusCode).toBe(200);

    await asMigratorIn(tenant.id, (client) =>
      insertRow(client, 'app.tenant_module', {
        tenant_id: tenant.id,
        module: 'grants',
        enabled: false,
        updated_by: owner.membershipId,
      }),
    );

    for (const [method, url, body] of routes) {
      expect((await t.send(owner, method, url, body)).statusCode, `${method} ${url}`).toBe(404);
    }
    expect(await rowsOf(tenant, 'SELECT count(*)::int AS n FROM grants.stage')).toEqual([{ n: 3 }]);
    expect((await t.send(t.managerA, 'GET', '/console/programmes')).statusCode).toBe(200);
  });
});
