// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Demo step 16, at the API: every console and portal route contract is called
// with ids taken from the first funder's records, and every answer is a
// refusal. As the second funder, each route gives 404 to the person who holds
// its permission; as a second applicant in the same funder, the own_* scopes
// give 404; as a second reviewer, assigned_review gives 404. A person who lacks
// a route's permission gets 403, and no one signed in gets 401. When it is all
// done, nothing of the first funder has changed.

import { Api } from '../support/api.ts';
import { eventsByAction, expectedEvents } from '../support/audit.ts';
import { consoleOrigin, portalOrigin } from '../support/env.ts';
import { keyOf, memberRoutes } from '../support/contracts.ts';
import { person } from '../support/state.ts';
import { cases } from '../isolation/cases.ts';
import { call, holds, personas, sorted, walkSide, type Finding } from '../isolation/walk.ts';
import { closeWorld, openWorld, type World } from '../isolation/world.ts';
import { expect, inOrder, test } from '../support/test.ts';

inOrder();

let opened: World | undefined;

function world(): World {
  if (opened === undefined) throw new Error('The isolation walk has no signed-in people.');
  return opened;
}
let before = '';

/** What reading the first funder's records gives, apart from the audited reads that reading adds. */
async function fingerprint(): Promise<string> {
  const { a, fixture } = world();
  const read = async (api: Api, path: string) => (await api.send('GET', path)).text;
  const events = [...(await eventsByAction(a.admin, Object.keys(expectedEvents))).values()].flat();
  return JSON.stringify([
    await read(a.manager, `/console/programmes/${fixture.programmeId}`),
    await read(a.manager, `/console/rounds/${fixture.roundId}`),
    await read(a.manager, `/console/rounds/${fixture.roundId}/stages`),
    await read(a.manager, `/console/rounds/${fixture.roundId}/form-versions`),
    await read(a.manager, `/console/rounds/${fixture.roundId}/decisions`),
    await read(a.manager, `/console/rounds/${fixture.roundId}/reviewers`),
    await read(a.admin, '/console/team'),
    await read(a.applicant, `/portal/applications/${fixture.applicationId}`),
    await read(a.applicant, `/portal/applications/${fixture.applicationId}/files`),
    await read(a.reviewer, '/console/reviews'),
    events.map(({ action, entityId }) => `${action} ${entityId}`),
  ]);
}

const refused = (findings: Finding[]): string[] =>
  findings.map(
    ({ who, route, status, wanted }) =>
      `${who}: ${route} answered ${String(status)}, wanted ${wanted}`,
  );

test.describe('step 16, at the API: every route refuses what is not the caller’s', () => {
  test.beforeAll(async () => {
    test.setTimeout(300_000);
    opened = await openWorld();
    before = await fingerprint();
  });

  test.afterAll(async () => {
    await closeWorld(opened);
  });

  test('has a case for every console and portal route, and for no route that is gone', () => {
    const { missing, record, list, own } = sorted();
    expect(missing).toEqual([]);
    expect(record.length).toBeGreaterThan(50);
    expect(record.length + list.length + own.length).toBe(memberRoutes().length);
    expect(Object.keys(cases)).toHaveLength(memberRoutes().length);
  });

  test('the second funder is refused: 404 for every record, and nothing of the first in any list', async () => {
    // The calls are not all refused for want of anything: the second funder’s own records answer.
    const control = await world().b.manager.ok<{ id: string }>('POST', '/console/programmes', {
      json: { title: 'Eastmoor probe', summary: 'Its own.', description: '', status: 'draft' },
    });
    expect((await world().b.manager.send('GET', `/console/programmes/${control.id}`)).status).toBe(
      200,
    );
    expect((await world().a.manager.send('GET', `/console/programmes/${control.id}`)).status).toBe(
      404,
    );

    const { findings, called } = await walkSide(world(), world().b, 'eastmoor');
    expect(refused(findings)).toEqual([]);
    // Every record and list route has someone on the second funder’s side who holds its permission.
    expect(called).toBe(sorted().record.length + sorted().list.length);
  });

  test('a second applicant in the same funder is refused every own_* scope', async () => {
    const { applicant, applicant2 } = world().a;
    const { fixture } = world();
    const mine = new Set(['own_application', 'own_organisation']);
    const findings: string[] = [];
    for (const route of sorted().record.filter(({ scope }) => mine.has(scope))) {
      const answer = await call(applicant2, route, fixture);
      if (answer.status !== 404) findings.push(`${keyOf(route)} answered ${String(answer.status)}`);
    }
    expect(findings).toEqual([]);

    // Starting an application for someone else’s organisation is refused, and the round itself is open to both.
    const start = sorted().record.find(
      ({ path }) => path === '/portal/rounds/:roundId/applications',
    );
    if (start === undefined) throw new Error('The portal has no route to start an application.');
    expect((await call(applicant2, start, fixture)).status).toBe(404);
    const round = `/portal/rounds/${fixture.roundId}`;
    expect((await applicant.send('GET', round)).status).toBe(200);
    expect((await applicant2.send('GET', round)).status).toBe(200);

    // Their own lists hold none of the first applicant’s records.
    const theirs = [
      fixture.applicationId,
      fixture.organisationId,
      fixture.fileId,
      'Eastmere',
      person('applicant1').email,
    ];
    for (const path of ['/portal/applications', '/portal/organisations', '/portal/profile']) {
      const answer = await applicant2.send('GET', path);
      expect(answer.status, path).toBe(200);
      for (const marker of theirs) expect(answer.text, `${path} ${marker}`).not.toContain(marker);
    }
  });

  test('a second reviewer is refused every assigned_review scope, and does not see the first’s assignment', async () => {
    const { reviewer2 } = world().a;
    const { fixture } = world();
    const findings: string[] = [];
    for (const route of sorted().record.filter(({ scope }) => scope === 'assigned_review')) {
      const answer = await call(reviewer2, route, fixture);
      if (answer.status !== 404) findings.push(`${keyOf(route)} answered ${String(answer.status)}`);
    }
    expect(findings).toEqual([]);
    const reviews = await reviewer2.send('GET', '/console/reviews');
    expect(reviews.status).toBe(200);
    expect(reviews.text).not.toContain(fixture.assignmentId);
  });

  test('a person without a route’s permission gets 403, in either app, with the first funder’s own ids', async () => {
    const findings: string[] = [];
    for (const route of [...sorted().record, ...sorted().list]) {
      for (const name of personas) {
        if (holds(name, route)) continue;
        const answer = await call(world().a[name], route, world().fixture);
        if (answer.status !== 403)
          findings.push(`${name}: ${keyOf(route)} answered ${String(answer.status)}`);
      }
    }
    expect(findings).toEqual([]);
  });

  test('no one signed in gets 401 from any route', async () => {
    const consoleApi = await Api.open(consoleOrigin);
    const portalApi = await Api.open(portalOrigin);
    const findings: string[] = [];
    for (const route of [...sorted().record, ...sorted().list]) {
      const answer = await call(
        route.audience === 'console' ? consoleApi : portalApi,
        route,
        world().fixture,
      );
      if (answer.status !== 401) findings.push(`${keyOf(route)} answered ${String(answer.status)}`);
    }
    expect(findings).toEqual([]);
    await consoleApi.dispose();
    await portalApi.dispose();
  });

  test('nothing of the first funder has changed', async () => {
    expect(await fingerprint()).toBe(before);
  });
});
