// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The impact routes through the whole API against the test database, as
// app_api: sessions, the policy, row-level security, the configuration
// versions and the audit log, for two tenants. Files are added clean, as
// the scanner would leave them, since the routes take evidence by file id.

import { randomUUID } from 'node:crypto';

import { impactMessages, impactRefusals } from '@pixel-scientists/impact/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { addFile } from '../../../packages/db/test/grants/application-fixtures.ts';
import { asMigratorIn, createTestTenant } from '../../../packages/db/test/tenants.ts';
import { switchModule } from './modules-on.ts';
import {
  answer,
  rowsOf,
  startProgrammeApi,
  storedVersions,
  type Method,
  type Problem,
  type ProgrammeApi,
} from './programme-api.ts';
import { addMember, events, type Member } from './settings-api.ts';
import { expectLooksMissing } from './support.ts';

// Each request runs a few statements in a transaction, which is slow on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

interface Framework {
  id: string;
  name: string;
  description: string;
  outcomes: Record<string, { name: string; description: string }>;
  indicators: Record<string, { outcomeId: string; name: string; unit: string }>;
  version: number;
  archivedAt: string | null;
}

interface Target {
  id: string;
  indicatorId: string;
  programmeId: string | null;
  periodStart: string;
  baseline: number | null;
  target: number;
}

interface Result {
  id: string;
  indicatorId: string;
  periodEnd: string;
  value: number;
  note: string;
  evidence: { fileId: string; caption: string }[];
  source: string;
}

interface Page {
  results: (Omit<Result, 'note' | 'evidence'> & { evidenceCount: number })[];
  nextCursor: string | null;
}

interface Summary {
  version: number;
  indicators: {
    indicatorId: string;
    value: number | null;
    resultCount: number;
    latestPeriodEnd: string | null;
    target: number | null;
    baseline: number | null;
  }[];
}

const FRAMEWORKS = '/console/outcome-frameworks';
const TARGETS = '/console/indicator-targets';
const RESULTS = '/console/indicator-results';
const NOTES = '/console/learning-notes';

/** A framework with two outcomes and three indicators, under new ids. */
function frameworkBody(change: object = {}) {
  const [wellbeing, skills] = [randomUUID(), randomUUID()];
  const [people, hours, rate] = [randomUUID(), randomUUID(), randomUUID()];
  const indicator = (outcomeId: string, name: string, unit: string, aggregation = 'sum') => ({
    outcomeId,
    name,
    unit,
    direction: 'increase',
    aggregation,
  });
  return {
    ids: { wellbeing, skills, people, hours, rate },
    body: {
      name: `Community outcomes ${randomUUID()}`,
      description: 'What the community programmes work towards.',
      outcomes: {
        [wellbeing]: { name: 'Better wellbeing', description: '' },
        [skills]: { name: 'New skills', description: 'Skills people use afterwards.' },
      },
      indicators: {
        [people]: indicator(wellbeing, 'People taking part', 'people'),
        [hours]: indicator(skills, 'Training hours', 'hours', 'average'),
        [rate]: indicator(skills, 'Completion rate', 'percentage', 'latest'),
      },
      ...change,
    },
  };
}

const period = (year = 2026) => ({
  periodStart: `${String(year)}-04-01`,
  periodEnd: `${String(year + 1)}-03-31`,
});

let t: ProgrammeApi;
let analyst: Member;

beforeAll(async () => {
  t = await startProgrammeApi('41123');
  await switchModule(t.tenantA, 'impact');
  await switchModule(t.tenantB, 'impact');
  analyst = await addMember(t.tenantA, 'console', 'analyst');
}, 60_000);

afterAll(async () => {
  await t.close();
});

const send = (method: Method, url: string, body?: unknown, member: Member = t.managerA) =>
  t.send(member, method, url, body);

async function aFramework(change: object = {}) {
  const { ids, body } = frameworkBody(change);
  const framework = await answer<Framework>(send('POST', FRAMEWORKS, body), 201);
  return { ids, body, framework, id: framework.id };
}

const targetBody = (frameworkId: string, indicatorId: string, change: object = {}) => ({
  frameworkId,
  indicatorId,
  programmeId: null,
  ...period(),
  baseline: null,
  target: 100,
  ...change,
});

const resultBody = (frameworkId: string, indicatorId: string, change: object = {}) => ({
  frameworkId,
  indicatorId,
  programmeId: null,
  ...period(),
  value: 40,
  note: '',
  evidence: [],
  ...change,
});

const aResult = (frameworkId: string, indicatorId: string, change: object = {}) =>
  answer<Result>(send('POST', RESULTS, resultBody(frameworkId, indicatorId, change)), 201);

const aFile = (state: 'clean' | 'pending' = 'clean') =>
  asMigratorIn(t.tenantA.id, (client) =>
    addFile(client, t.tenantA, t.managerA.membershipId, state),
  );

/** Every impact route, with a valid request for the ids given. */
function everyRoute(made: {
  framework: string;
  indicator: string;
  target: string;
  result: string;
  note: string;
}): [Method, string, unknown, 'read' | 'manage' | 'record'][] {
  const { framework: f, indicator } = made;
  return [
    ['GET', FRAMEWORKS, undefined, 'read'],
    ['GET', `${FRAMEWORKS}/${f}`, undefined, 'read'],
    ['POST', FRAMEWORKS, frameworkBody().body, 'manage'],
    ['PUT', `${FRAMEWORKS}/${f}`, frameworkBody().body, 'manage'],
    ['GET', `${FRAMEWORKS}/${f}/summary`, undefined, 'read'],
    ['GET', `${FRAMEWORKS}/${f}/targets`, undefined, 'read'],
    ['POST', TARGETS, targetBody(f, indicator, period(2030)), 'manage'],
    ['PUT', `${TARGETS}/${made.target}`, { baseline: 1, target: 2 }, 'manage'],
    ['GET', `${RESULTS}?frameworkId=${f}`, undefined, 'read'],
    ['GET', `${RESULTS}/${made.result}`, undefined, 'read'],
    ['POST', RESULTS, resultBody(f, indicator), 'record'],
    ['PUT', `${RESULTS}/${made.result}`, { value: 41, note: '', evidence: [] }, 'record'],
    ['GET', `${FRAMEWORKS}/${f}/learning-notes`, undefined, 'read'],
    ['POST', NOTES, { frameworkId: f, outcomeId: null, text: 'A note.' }, 'record'],
    ['DELETE', `${NOTES}/${made.note}`, undefined, 'record'],
    ['DELETE', `${RESULTS}/${made.result}`, undefined, 'record'],
    ['DELETE', `${TARGETS}/${made.target}`, undefined, 'manage'],
    ['POST', `${FRAMEWORKS}/${f}/archive`, undefined, 'manage'],
  ];
}

/** A framework of tenant A's with a target, a result and a note. */
async function aFrameworkInUse() {
  const { id, ids } = await aFramework();
  const target = await answer<Target>(send('POST', TARGETS, targetBody(id, ids.people)), 201);
  const result = await aResult(id, ids.people);
  const note = await answer<{ id: string }>(
    send('POST', NOTES, { frameworkId: id, outcomeId: ids.skills, text: 'A note.' }),
    201,
  );
  const made = {
    framework: id,
    indicator: ids.people,
    target: target.id,
    result: result.id,
    note: note.id,
  };
  return { id, ids, made };
}

const counts = () =>
  rowsOf(
    t.tenantA,
    `SELECT (SELECT count(*) FROM impact.framework)::int AS frameworks,
            (SELECT count(*) FROM impact.target)::int AS targets,
            (SELECT count(*) FROM impact.result)::int AS results,
            (SELECT count(*) FROM impact.learning_note)::int AS notes,
            (SELECT count(*) FROM app.config_version)::int AS versions,
            (SELECT count(*) FROM impact.framework WHERE archived_at IS NOT NULL)::int AS archived`,
  );

describe('who may use the impact routes', () => {
  it('refuse a reviewer, an applicant and a signed-out caller, and change nothing', async () => {
    const { made } = await aFrameworkInUse();
    const before = await counts();
    const routes = everyRoute(made);
    expect(routes).toHaveLength(18);
    for (const [method, url, body] of routes) {
      const reviewer = await send(method, url, body, t.reviewerA);
      expect(reviewer.statusCode, `${method} ${url}`).toBe(403);
      const applicant = await t.send(t.applicantA, method, url, body);
      expect(applicant.statusCode, `${method} ${url} as an applicant`).toBe(403);
      const inPortal = await t.send(t.managerA, method, url, body, 'portal');
      expect(inPortal.statusCode, `${method} ${url} in the portal`).toBe(403);
      const signedOut = await t.send(undefined, method, url, body);
      expect(signedOut.statusCode, `${method} ${url} signed out`).toBe(401);
    }
    expect(await counts()).toEqual(before);
  });

  it('let an analyst read everything and change nothing', async () => {
    const { made } = await aFrameworkInUse();
    const before = await counts();
    for (const [method, url, body, needs] of everyRoute(made)) {
      const response = await send(method, url, body, analyst);
      expect(response.statusCode, `${method} ${url}`).toBe(needs === 'read' ? 200 : 403);
    }
    expect(await counts()).toEqual(before);
  });

  it('answer 404 on every route while impact is off, and keep the rows', async () => {
    const tenant = await createTestTenant();
    const owner = await addMember(tenant, 'console', 'programme_manager');
    for (const [method, url, body] of everyRoute({
      framework: randomUUID(),
      indicator: randomUUID(),
      target: randomUUID(),
      result: randomUUID(),
      note: randomUUID(),
    })) {
      expect((await send(method, url, body, owner)).statusCode, `${method} ${url}`).toBe(404);
    }
    await switchModule(tenant, 'impact');
    const { body } = frameworkBody();
    const made = await answer<Framework>(send('POST', FRAMEWORKS, body, owner), 201);
    await switchModule(tenant, 'impact', false);
    expect((await send('GET', `${FRAMEWORKS}/${made.id}`, undefined, owner)).statusCode).toBe(404);
    expect(await rowsOf(tenant, 'SELECT count(*)::int AS n FROM impact.framework')).toEqual([
      { n: 1 },
    ]);
  });
});

describe('another tenant’s records', () => {
  it('read as missing on every route that takes an id, and nothing of theirs changes', async () => {
    const { made } = await aFrameworkInUse();
    const unknown = {
      framework: randomUUID(),
      indicator: randomUUID(),
      target: randomUUID(),
      result: randomUUID(),
      note: randomUUID(),
    };
    const before = await counts();
    const real = everyRoute(made);
    const absent = everyRoute(unknown);
    const bodies = new Set(['POST /console/outcome-frameworks', 'GET /console/outcome-frameworks']);
    let withId = 0;
    for (const [index, [method, url, body]] of real.entries()) {
      if (bodies.has(`${method} ${url}`)) continue;
      withId += 1;
      const outside = await send(method, url, body, t.managerB);
      const missing = await send(method, absent[index]?.[1] ?? '', absent[index]?.[2], t.managerB);
      expect(outside.statusCode, `${method} ${url}`).toBe(404);
      expectLooksMissing(outside, missing);
    }
    expect(withId).toBe(16);
    expect(await counts()).toEqual(before);
    const listed = await answer<{ frameworks: unknown[] }>(
      send('GET', FRAMEWORKS, undefined, t.managerB),
    );
    expect(listed.frameworks).toEqual([]);
  });
});

describe('a framework', () => {
  it('is made with its first version and audit event, and a replay makes nothing more', async () => {
    const { ids, body } = frameworkBody();
    const key = randomUUID();
    const post = () => t.send(t.managerA, 'POST', FRAMEWORKS, body, 'console', null, key);
    const made = await answer<Framework>(post(), 201);
    expect(made).toMatchObject({ name: body.name, version: 1, archivedAt: null });
    expect(Object.keys(made.outcomes)).toEqual([ids.wellbeing, ids.skills]);
    expect(Object.keys(made.indicators)).toEqual([ids.people, ids.hours, ids.rate]);
    expect(made.indicators[ids.rate]).toMatchObject({ outcomeId: ids.skills, unit: 'percentage' });

    const replayed = await answer<Framework>(post(), 201);
    expect(replayed.id).toBe(made.id);

    const versions = await storedVersions(t.tenantA, 'impact.framework', made.id);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ version: 1, author_id: t.managerA.membershipId });
    const paths = versions[0]?.diff.changes.map((change) => change.path) ?? [];
    expect(paths).toContain('name');
    expect(paths).toContain(`outcomes.${ids.skills}.description`);
    expect(paths).toContain(`indicators.${ids.rate}.aggregation`);
    expect(paths).toHaveLength(2 + 2 * 2 + 3 * 5);

    const [event] = (await events(t.tenantA, 'impact.framework.created')).filter(
      (row) => row.entity_id === made.id,
    );
    expect(event?.actor_id).toBe(t.managerA.membershipId);
    expect(event?.changes['impact.framework.name']).toEqual({ before: null, after: body.name });
    expect(event?.changes['impact.outcome.description']).toEqual({});

    const listed = await answer<{ frameworks: { id: string; indicatorCount: number }[] }>(
      send('GET', FRAMEWORKS),
    );
    expect(listed.frameworks.find((row) => row.id === made.id)).toMatchObject({
      outcomeCount: 2,
      indicatorCount: 3,
    });
  });

  it('takes a change as its next version, and a save that changes nothing as none', async () => {
    const { id, ids, body } = await aFramework();
    const url = `${FRAMEWORKS}/${id}`;
    const same = await answer<Framework>(send('PUT', url, body));
    expect(same.version).toBe(1);

    const added = randomUUID();
    const changed = {
      ...body,
      name: `${body.name} revised`,
      outcomes: {
        ...body.outcomes,
        [ids.wellbeing]: { name: 'Better wellbeing', description: 'As people report it.' },
      },
      indicators: {
        [added]: { ...body.indicators[ids.people], name: 'Sessions run', unit: 'count' },
        [ids.people]: body.indicators[ids.people],
        [ids.hours]: { ...body.indicators[ids.hours], outcomeId: ids.wellbeing },
      },
    };
    const next = await answer<Framework>(send('PUT', url, changed));
    expect(next.version).toBe(2);
    expect(Object.keys(next.indicators)).toEqual([added, ids.people, ids.hours]);

    const versions = await storedVersions(t.tenantA, 'impact.framework', id);
    expect(versions.map((row) => row.version)).toEqual([1, 2]);
    const diff = Object.fromEntries(
      versions[1]?.diff.changes.map(({ path, from, to }) => [path, [from, to]]) ?? [],
    );
    expect(diff['name']).toEqual([body.name, changed.name]);
    expect(diff[`outcomes.${ids.wellbeing}.description`]).toEqual(['', 'As people report it.']);
    expect(diff[`indicators.${ids.hours}.outcome`]).toEqual([ids.skills, ids.wellbeing]);
    expect(diff[`indicators.${added}.unit`]).toEqual([null, 'count']);
    expect(diff[`indicators.${ids.rate}.name`]).toEqual(['Completion rate', null]);
    expect(await events(t.tenantA, 'impact.framework.changed')).toContainEqual(
      expect.objectContaining({ entity_id: id }),
    );
  });

  it('keeps its version when only the order changes', async () => {
    const { id, ids, body } = await aFramework();
    const reordered = {
      ...body,
      outcomes: {
        [ids.skills]: body.outcomes[ids.skills],
        [ids.wellbeing]: body.outcomes[ids.wellbeing],
      },
    };
    const saved = await answer<Framework>(send('PUT', `${FRAMEWORKS}/${id}`, reordered));
    expect(saved.version).toBe(1);
    expect(Object.keys(saved.outcomes)).toEqual([ids.skills, ids.wellbeing]);
    expect(await storedVersions(t.tenantA, 'impact.framework', id)).toHaveLength(1);
  });

  it('refuses a name or an item another framework has', async () => {
    const first = await aFramework();
    const taken = await send('POST', FRAMEWORKS, {
      ...frameworkBody().body,
      name: first.body.name.toUpperCase(),
    });
    expect(taken.statusCode).toBe(409);
    expect(taken.json<Problem>().detail).toBe(impactRefusals.nameTaken);

    const copied = await send('POST', FRAMEWORKS, {
      ...first.body,
      name: `${first.body.name} copy`,
    });
    expect(copied.statusCode).toBe(409);
    expect(copied.json<Problem>().detail).toBe(impactRefusals.itemTaken);
    const again = await aFramework();
    const renamed = await send('PUT', `${FRAMEWORKS}/${again.id}`, {
      ...again.body,
      name: first.body.name,
    });
    expect(renamed.statusCode).toBe(409);
  });

  it('refuses a body that breaks its rules, naming the field', async () => {
    const { body, ids } = frameworkBody();
    const orphan = await send('POST', FRAMEWORKS, {
      ...body,
      indicators: {
        [ids.people]: { ...body.indicators[ids.people], outcomeId: randomUUID() },
      },
    });
    expect(orphan.statusCode).toBe(400);
    expect(orphan.json<Problem>().errors).toContainEqual({
      field: 'body.indicators',
      message: impactMessages.indicatorOutcome,
    });
    const unnamed = await send('POST', FRAMEWORKS, { ...body, name: ' ' });
    expect(unnamed.statusCode).toBe(400);
  });

  it('keeps an indicator, a unit and an outcome that are in use', async () => {
    const { id, ids } = await aFrameworkInUse();
    const url = `${FRAMEWORKS}/${id}`;
    const current = await answer<Framework>(send('GET', url));
    const body = {
      name: current.name,
      description: current.description,
      outcomes: current.outcomes,
      indicators: current.indicators,
    };
    const without = (record: Record<string, unknown>, id: string) =>
      Object.fromEntries(Object.entries(record).filter(([key]) => key !== id));
    const refused = async (change: object, detail: string) => {
      const response = await send('PUT', url, { ...body, ...change });
      expect(response.statusCode, detail).toBe(409);
      expect(response.json<Problem>().detail).toBe(detail);
    };

    await refused(
      { indicators: without(body.indicators, ids.people) },
      impactRefusals.indicatorInUse,
    );
    await refused(
      {
        indicators: {
          ...body.indicators,
          [ids.people]: { ...body.indicators[ids.people], unit: 'count' },
        },
      },
      impactRefusals.unitFixed,
    );
    await refused(
      {
        outcomes: without(body.outcomes, ids.skills),
        indicators: without(without(body.indicators, ids.hours), ids.rate),
      },
      impactRefusals.outcomeInUse,
    );
    expect((await answer<Framework>(send('GET', url))).version).toBe(1);

    const unused = await answer<Framework>(
      send('PUT', url, { ...body, indicators: without(body.indicators, ids.rate) }),
    );
    expect(Object.keys(unused.indicators)).toEqual([ids.people, ids.hours]);
  });

  it('once archived takes no change, target, result or note, and archives twice as once', async () => {
    const { id, ids, made } = await aFrameworkInUse();
    const { body } = frameworkBody();
    const archived = await answer<Framework>(send('POST', `${FRAMEWORKS}/${id}/archive`));
    expect(archived.archivedAt).not.toBeNull();
    const again = await answer<Framework>(send('POST', `${FRAMEWORKS}/${id}/archive`));
    expect(again.archivedAt).toBe(archived.archivedAt);
    expect(
      (await events(t.tenantA, 'impact.framework.archived')).filter((row) => row.entity_id === id),
    ).toHaveLength(1);

    for (const [method, url, payload] of [
      ['PUT', `${FRAMEWORKS}/${id}`, body],
      ['POST', TARGETS, targetBody(id, ids.hours)],
      ['PUT', `${TARGETS}/${made.target}`, { baseline: null, target: 5 }],
      ['DELETE', `${TARGETS}/${made.target}`, undefined],
      ['POST', RESULTS, resultBody(id, ids.people)],
      ['PUT', `${RESULTS}/${made.result}`, { value: 5, note: '', evidence: [] }],
      ['DELETE', `${RESULTS}/${made.result}`, undefined],
      ['POST', NOTES, { frameworkId: id, outcomeId: null, text: 'Too late.' }],
      ['DELETE', `${NOTES}/${made.note}`, undefined],
    ] as const) {
      const response = await send(method, url, payload);
      expect(response.statusCode, `${method} ${url}`).toBe(409);
      expect(response.json<Problem>().detail).toBe(impactRefusals.archived);
    }
    expect((await send('GET', `${RESULTS}/${made.result}`)).statusCode).toBe(200);
  });
});

describe('a target', () => {
  it('is set once for an indicator, programme and period, changed and removed', async () => {
    const { id, ids } = await aFramework();
    const programme = await t.aProgramme();
    const overall = await answer<Target>(
      send('POST', TARGETS, targetBody(id, ids.people, { baseline: 20 })),
      201,
    );
    expect(overall).toMatchObject({ baseline: 20, target: 100, periodStart: '2026-04-01' });
    const forProgramme = await answer<Target>(
      send('POST', TARGETS, targetBody(id, ids.people, { programmeId: programme.id })),
      201,
    );
    await answer<Target>(send('POST', TARGETS, targetBody(id, ids.people, period(2025))), 201);

    const twice = await send('POST', TARGETS, targetBody(id, ids.people));
    expect(twice.statusCode).toBe(409);
    expect(twice.json<Problem>().detail).toBe(impactRefusals.targetExists);

    const listed = await answer<{ targets: Target[] }>(send('GET', `${FRAMEWORKS}/${id}/targets`));
    expect(listed.targets.map((row) => row.periodStart)).toEqual([
      '2025-04-01',
      '2026-04-01',
      '2026-04-01',
    ]);

    const url = `${TARGETS}/${overall.id}`;
    const changed = await answer<Target>(send('PUT', url, { baseline: 20, target: 150 }));
    expect(changed.target).toBe(150);
    await answer<Target>(send('PUT', url, { baseline: 20, target: 150 }));
    const changes = (await events(t.tenantA, 'impact.target.changed')).filter(
      (row) => row.entity_id === overall.id,
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]?.changes).toEqual({ 'impact.target.target': { before: 100, after: 150 } });

    expect((await send('DELETE', `${TARGETS}/${forProgramme.id}`)).statusCode).toBe(204);
    expect((await send('DELETE', `${TARGETS}/${forProgramme.id}`)).statusCode).toBe(404);
    expect(await events(t.tenantA, 'impact.target.removed')).toContainEqual(
      expect.objectContaining({ entity_id: forProgramme.id }),
    );
  });

  it('refuses an indicator or programme that is not there, and a figure off its unit', async () => {
    const { id, ids } = await aFramework();
    const other = await aFramework();
    const field = async (change: object, name: string, message: string) => {
      const response = await send('POST', TARGETS, targetBody(id, ids.people, change));
      expect(response.statusCode, name).toBe(400);
      expect(response.json<Problem>().errors).toEqual([{ field: `body.${name}`, message }]);
    };
    await field({ indicatorId: other.ids.people }, 'indicatorId', impactMessages.indicator);
    await field({ programmeId: randomUUID() }, 'programmeId', impactMessages.programme);
    await field({ periodEnd: '2026-03-31' }, 'periodEnd', impactMessages.periodOrder);

    for (const body of [
      targetBody(id, ids.people, { target: 10.5 }),
      targetBody(id, ids.rate, { target: 101 }),
      targetBody(id, ids.rate, { baseline: 100.5, target: 50 }),
    ]) {
      const response = await send('POST', TARGETS, body);
      expect(response.statusCode).toBe(409);
      expect(response.json<Problem>().detail).toBe(impactRefusals.valueForUnit);
    }
    await answer<Target>(send('POST', TARGETS, targetBody(id, ids.hours, { target: 10.5 })), 201);
  });
});

describe('a result', () => {
  it('is recorded with its evidence, corrected and removed, and its files follow', async () => {
    const { id, ids } = await aFramework();
    const [first, second, third] = [await aFile(), await aFile(), await aFile()];
    const made = await aResult(id, ids.people, {
      note: 'Counted at the door.',
      evidence: [
        { fileId: first, caption: 'Attendance sheet' },
        { fileId: second, caption: 'Survey summary' },
      ],
    });
    expect(made).toMatchObject({ value: 40, note: 'Counted at the door.', source: 'manual' });
    expect(made.evidence.map((item) => item.fileId).sort()).toEqual([first, second].sort());

    const url = `${RESULTS}/${made.id}`;
    const corrected = await answer<Result>(
      send('PUT', url, {
        value: 42,
        note: 'Counted at the door, twice.',
        evidence: [
          { fileId: second, caption: 'Survey summary, final' },
          { fileId: third, caption: 'Photographs of the tally' },
        ],
      }),
    );
    expect(corrected.value).toBe(42);
    expect(corrected.evidence).toEqual([
      { fileId: second, caption: 'Survey summary, final' },
      { fileId: third, caption: 'Photographs of the tally' },
    ]);
    const [event] = (await events(t.tenantA, 'impact.result.corrected')).filter(
      (row) => row.entity_id === made.id,
    );
    expect(event?.changes).toEqual({
      'impact.result.value': { before: 40, after: 42 },
      'impact.result.note': {},
      'impact.result_evidence.file_id': {},
      'impact.result_evidence.caption': {},
    });
    expect(JSON.stringify(event)).not.toContain('door');

    await answer<Result>(
      send('PUT', url, { value: 42, note: corrected.note, evidence: corrected.evidence }),
    );
    expect(
      (await events(t.tenantA, 'impact.result.corrected')).filter(
        (row) => row.entity_id === made.id,
      ),
    ).toHaveLength(1);

    const files = () =>
      rowsOf<{ id: string; linked: boolean; released: boolean }>(
        t.tenantA,
        `SELECT id, linked_at IS NOT NULL AS linked, released_at IS NOT NULL AS released
           FROM app.file WHERE id = ANY($1)`,
        [[first, second, third]],
      );
    const state = async () =>
      Object.fromEntries((await files()).map((file) => [file.id, [file.linked, file.released]]));
    expect(await state()).toEqual({
      [first]: [true, true],
      [second]: [true, false],
      [third]: [true, false],
    });

    expect((await send('DELETE', url)).statusCode).toBe(204);
    expect((await send('GET', url)).statusCode).toBe(404);
    expect(Object.values(await state())).toEqual([
      [true, true],
      [true, true],
      [true, true],
    ]);
  });

  it('refuses a file that is not ready or is already used, naming it', async () => {
    const { id, ids } = await aFramework();
    const [clean, pending] = [await aFile(), await aFile('pending')];
    const used = await aFile();
    await aResult(id, ids.people, { evidence: [{ fileId: used, caption: 'Used once' }] });
    const response = await send(
      'POST',
      RESULTS,
      resultBody(id, ids.people, {
        evidence: [
          { fileId: clean, caption: 'Ready' },
          { fileId: pending, caption: 'Still scanning' },
          { fileId: used, caption: 'Used elsewhere' },
          { fileId: randomUUID(), caption: 'Never uploaded' },
        ],
      }),
    );
    expect(response.statusCode).toBe(400);
    expect(response.json<Problem>().errors?.map((error) => error.field)).toEqual([
      'body.evidence.1.fileId',
      'body.evidence.2.fileId',
      'body.evidence.3.fileId',
    ]);
    const other = await send(
      'POST',
      RESULTS,
      resultBody(id, ids.people, { evidence: [{ fileId: clean, caption: 'Ready' }] }),
    );
    expect(other.statusCode).toBe(201);
  });

  it('refuses a figure off its unit, and an indicator of another framework', async () => {
    const { id, ids } = await aFramework();
    const other = await aFramework();
    const offUnit = await send('POST', RESULTS, resultBody(id, ids.people, { value: 1.5 }));
    expect(offUnit.statusCode).toBe(409);
    expect(offUnit.json<Problem>().detail).toBe(impactRefusals.valueForUnit);
    const made = await aResult(id, ids.rate, { value: 99.5 });
    const over = await send('PUT', `${RESULTS}/${made.id}`, {
      value: 100.5,
      note: '',
      evidence: [],
    });
    expect(over.statusCode).toBe(409);
    const elsewhere = await send('POST', RESULTS, resultBody(id, other.ids.people));
    expect(elsewhere.statusCode).toBe(400);
    expect(elsewhere.json<Problem>().errors).toEqual([
      { field: 'body.indicatorId', message: impactMessages.indicator },
    ]);
  });

  it('lists by framework, indicator and programme, latest period first, a page at a time', async () => {
    const { id, ids } = await aFramework();
    const programme = await t.aProgramme();
    const file = await aFile();
    const latest = await aResult(id, ids.people, {
      ...period(2090),
      programmeId: programme.id,
      evidence: [{ fileId: file, caption: 'Attendance sheet' }],
    });
    await aResult(id, ids.hours, { value: 7.5 });
    await asMigratorIn(t.tenantA.id, (client) =>
      client.query(
        `INSERT INTO impact.result (tenant_id, framework_id, indicator_id, period_start,
                                    period_end, value, recorded_by, updated_by)
         SELECT $1, $2, $3, make_date(2000 + n, 4, 1), make_date(2001 + n, 3, 31), n, $4, $4
           FROM generate_series(1, 55) AS n`,
        [t.tenantA.id, id, ids.people, t.managerA.membershipId],
      ),
    );

    const list = (query: string) =>
      answer<Page>(send('GET', `${RESULTS}?frameworkId=${id}${query}`));
    const first = await list('');
    expect(first.results).toHaveLength(50);
    expect(first.results[0]).toMatchObject({ id: latest.id, evidenceCount: 1 });
    expect(first.results[0]).not.toHaveProperty('note');
    const second = await list(`&cursor=${first.nextCursor ?? ''}`);
    expect(second.results).toHaveLength(7);
    expect(second.nextCursor).toBeNull();
    const ends = [...first.results, ...second.results].map((row) => row.periodEnd);
    expect(ends).toEqual([...ends].sort().reverse());
    expect(new Set([...first.results, ...second.results].map((row) => row.id)).size).toBe(57);

    expect((await list(`&indicatorId=${ids.hours}`)).results.map((row) => row.value)).toEqual([
      7.5,
    ]);
    expect((await list(`&programmeId=${programme.id}`)).results.map((row) => row.id)).toEqual([
      latest.id,
    ]);
    const stale = await send('GET', `${RESULTS}?frameworkId=${id}&cursor=bm90LWEtY3Vyc29y`);
    expect(stale.statusCode).toBe(400);
    expect(stale.json<Problem>().detail).toBe(impactRefusals.page);
  });
});

describe('a learning note', () => {
  it('is added to a framework or one of its outcomes, listed newest first, and removed', async () => {
    const { id, ids } = await aFramework();
    const other = await aFramework();
    const add = (outcomeId: string | null, text: string) =>
      send('POST', NOTES, { frameworkId: id, outcomeId, text });
    const first = await answer<{ id: string; text: string }>(
      add(null, 'Evening sessions reach more people.'),
      201,
    );
    const second = await answer<{ id: string; outcomeId: string }>(
      add(ids.skills, 'Short courses are finished more often.'),
      201,
    );
    expect(second.outcomeId).toBe(ids.skills);

    const elsewhere = await add(other.ids.skills, 'Not this framework.');
    expect(elsewhere.statusCode).toBe(400);
    expect(elsewhere.json<Problem>().errors).toEqual([
      { field: 'body.outcomeId', message: impactMessages.outcome },
    ]);
    expect((await add(null, '')).statusCode).toBe(400);

    const url = `${FRAMEWORKS}/${id}/learning-notes`;
    const listed = await answer<{ notes: { id: string }[] }>(send('GET', url));
    expect(listed.notes.map((note) => note.id)).toEqual([second.id, first.id]);

    expect((await send('DELETE', `${NOTES}/${first.id}`)).statusCode).toBe(204);
    expect((await send('DELETE', `${NOTES}/${first.id}`)).statusCode).toBe(404);
    expect((await answer<{ notes: unknown[] }>(send('GET', url))).notes).toHaveLength(1);
    const added = await events(t.tenantA, 'impact.learning_note.added');
    expect(JSON.stringify(added)).not.toContain('Evening');
  });
});

describe('a framework’s summary', () => {
  it('combines each indicator’s results and targets by its own rule', async () => {
    const { id, ids } = await aFramework();
    const programme = await t.aProgramme();
    const own = { programmeId: programme.id };
    for (const [indicator, change] of [
      [ids.people, { value: 40 }],
      [ids.people, { value: 25, ...own }],
      [ids.people, { value: 10, ...period(2025) }],
      [ids.hours, { value: 7.5 }],
      [ids.hours, { value: 10, ...own }],
      [ids.hours, { value: 3.21, ...period(2025) }],
      [ids.rate, { value: 60, ...period(2025) }],
      [ids.rate, { value: 82.5, ...own }],
    ] as const) {
      await aResult(id, indicator, change);
    }
    for (const body of [
      targetBody(id, ids.people, { baseline: 20, target: 100 }),
      targetBody(id, ids.people, { target: 50, ...own }),
      targetBody(id, ids.rate, { baseline: 55, target: 70, ...period(2025) }),
      targetBody(id, ids.rate, { target: 90 }),
    ]) {
      await answer<Target>(send('POST', TARGETS, body), 201);
    }

    const summary = (query = '') =>
      answer<Summary>(send('GET', `${FRAMEWORKS}/${id}/summary${query}`));
    const all = await summary();
    expect(all.version).toBe(1);
    expect(all.indicators).toEqual([
      {
        indicatorId: ids.people,
        value: 75,
        resultCount: 3,
        latestPeriodEnd: '2027-03-31',
        target: 150,
        baseline: 20,
      },
      {
        indicatorId: ids.hours,
        value: 6.9,
        resultCount: 3,
        latestPeriodEnd: '2027-03-31',
        target: null,
        baseline: null,
      },
      {
        indicatorId: ids.rate,
        value: 82.5,
        resultCount: 2,
        latestPeriodEnd: '2027-03-31',
        target: 90,
        baseline: 55,
      },
    ]);

    const forProgramme = await summary(`?programmeId=${programme.id}`);
    expect(forProgramme.indicators.map((row) => [row.value, row.target])).toEqual([
      [25, 50],
      [10, null],
      [82.5, null],
    ]);
    const earlier = await summary('?from=2025-04-01&to=2026-03-31');
    expect(earlier.indicators.map((row) => [row.value, row.resultCount, row.target])).toEqual([
      [10, 1, null],
      [3.21, 1, null],
      [60, 1, 70],
    ]);
    const backwards = await send(
      'GET',
      `${FRAMEWORKS}/${id}/summary?from=2026-04-01&to=2025-04-01`,
    );
    expect(backwards.statusCode).toBe(400);
  });
});
