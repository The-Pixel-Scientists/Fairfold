// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Cross-tenant isolation over the whole route list: every console and portal
// route in the OpenAPI document (and any contract the document lacks) is
// called by each of the second funder's people with the first funder's ids.
// A record answers 404, or 403 where the person lacks the permission; a list
// answers with nothing of the first funder's; and the first funder's records
// read the same afterwards. Rule 6: no route takes a tenant or an actor from
// the request.

import { cases } from '../../isolation/cases.ts';
import { leaksIn } from '../../isolation/walk.ts';
import { closeWorld, openWorld, type World } from '../../isolation/world.ts';
import { axePages } from '../../support/axe.ts';
import { expect, h1, inOrder, test } from '../../support/test.ts';
import {
  allRoutes,
  callFor,
  fixture,
  paramsOf,
  pathFor,
  sendRoute,
  type ModuleRoute,
} from './routes.ts';

inOrder();

const second = fixture.tenants.b;
let opened: World | undefined;
let before = '';

function world(): World {
  if (opened === undefined) throw new Error('The isolation walk has no signed-in people.');
  return opened;
}

/** What reading the first funder's records gives, apart from the audited reads that reading adds. */
async function fingerprint(): Promise<string> {
  const { a, fixture: ids } = world();
  const read = async (api: typeof a.manager, path: string) => (await api.send('GET', path)).text;
  return JSON.stringify([
    await read(a.manager, `/console/programmes/${ids.programmeId}`),
    await read(a.manager, `/console/rounds/${ids.roundId}`),
    await read(a.manager, `/console/rounds/${ids.roundId}/stages`),
    await read(a.manager, `/console/rounds/${ids.roundId}/decisions`),
    await read(a.admin, '/console/team'),
    await read(a.admin, '/console/settings/modules'),
    await read(a.applicant, `/portal/applications/${ids.applicationId}`),
    await read(a.reviewer, '/console/reviews'),
  ]);
}

type Expectation = 'record' | 'list' | 'skip';

/** What a route owes the second funder: a refusal, an answer free of the first funder's data, or no call. */
function expectation(route: ModuleRoute): Expectation {
  const entry = cases[route.key];
  if (entry !== undefined) return entry.kind === 'own' ? 'skip' : entry.kind;
  if (paramsOf(route.path).length > 0) return 'record';
  return route.method === 'GET' ? 'list' : 'skip';
}

test.describe('the second funder cannot reach the first funder through any route', () => {
  test.beforeAll(async () => {
    test.setTimeout(300_000);
    opened = await openWorld();
    before = await fingerprint();
  });

  test.afterAll(async () => {
    await closeWorld(opened);
  });

  test('every console and portal route refuses each person, and the first funder is unchanged', async () => {
    const { b, fixture: ids, markers } = world();
    const people = {
      console: [b.admin, b.manager, b.reviewer],
      portal: [b.applicant],
    } as const;
    const problems: string[] = [];
    let called = 0;
    for (const route of allRoutes().filter(({ audience }) => audience !== 'public')) {
      const kind = expectation(route);
      if (kind === 'skip') continue;
      const path = pathFor(route, ids, second.slug);
      const call = callFor(route, ids);
      const request = `${path}${JSON.stringify(call.query ?? {})}`;
      for (const api of people[route.audience === 'portal' ? 'portal' : 'console']) {
        const answer = await sendRoute(api, route, path, call);
        called += 1;
        const leaked = leaksIn(answer, markers, request);
        const allowed = kind === 'list' ? [200, 403, 404] : [403, 404];
        if (leaked.length > 0) {
          problems.push(`${route.key} answered ${String(answer.status)} with ${leaked.join(', ')}`);
        } else if (!allowed.includes(answer.status)) {
          problems.push(
            `${route.key} answered ${String(answer.status)}, wanted ${allowed.join(' or ')}`,
          );
        }
      }
    }
    expect(called).toBeGreaterThan(50);
    expect.soft(problems).toEqual([]);
    expect(await fingerprint(), 'the first funder reads differently after the walk').toBe(before);
  });

  test('a tenant or an actor in the query or the body is refused and changes nothing', async () => {
    const { b, fixture: ids, markers } = world();
    const programmes = async () => (await b.manager.send('GET', '/console/programmes')).text;
    const own = await programmes();
    const programme = {
      title: 'Eastmoor probe',
      summary: 'Its own.',
      description: '',
      status: 'draft',
    };
    for (const name of ['tenantId', 'tenant_id', 'actorId', 'membershipId']) {
      const inQuery = await b.manager.send('GET', '/console/programmes', {
        query: { [name]: ids.programmeId },
      });
      expect([400, 422], `${name} in the query`).toContain(inQuery.status);
      const inBody = await b.manager.send('POST', '/console/programmes', {
        json: { ...programme, [name]: ids.programmeId },
      });
      expect([400, 422], `${name} in the body`).toContain(inBody.status);
    }
    const after = await programmes();
    expect(after).toBe(own);
    expect(markers.filter((marker) => after.includes(marker))).toEqual([]);
  });

  test('@a11y a page for the first funder’s record shows the second funder nothing of it', async ({
    pages,
  }) => {
    const { fixture: ids, markers } = world();
    const page = await pages.staff(second.accounts.manager, second.slug);
    await axePages(page, [`/${second.slug}/programmes/${ids.programmeId}`]);
    await expect(h1(page, /./).first()).toBeVisible();
    const text = (await page.getByRole('main').innerText()) + (await page.title());
    expect(markers.filter((marker) => text.includes(marker))).toEqual([]);
  });
});
