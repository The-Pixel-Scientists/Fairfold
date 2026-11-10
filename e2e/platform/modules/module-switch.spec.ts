// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Module switch (ADR 0016, ADR 0024): in the second funder, each switchable
// module is switched off by the administrator, and every route of the module
// answers 404 while its section leaves the console and the portal. Switched
// on again, its routes and section return and the data it held is still
// there. Each switch writes one audit event with the administrator as actor.
// The platform and party never switch. Only the second funder's modules are
// switched, so the demo journey's Grants is untouched; the suite restores the
// seeded state when it ends, even after a failure.

import {
  modules,
  switchableModuleIds,
  type SwitchableModuleId,
} from '../../../packages/domain/src/platform/modules.ts';
import { closeWorld, openWorld, type World } from '../../isolation/world.ts';
import { cases } from '../../isolation/cases.ts';
import { axePages } from '../../support/axe.ts';
import { expect, h1, inOrder, test } from '../../support/test.ts';
import { callAsSecond, callerFor, notRefused } from './refusals.ts';
import {
  allRoutes,
  callFor,
  fixture,
  paramsOf,
  pathFor,
  routesByModule,
  sendRoute,
} from './routes.ts';
import { moduleStates, readSession, restoreSeeded, switchTo } from './switching.ts';

inOrder();

const second = fixture.tenants.b;
const slug = second.slug;
const grouped = routesByModule();

let opened: World | undefined;
let keptProgrammeId = '';
const KEPT_TITLE = 'Eastmoor module switch probe';

function world(): World {
  if (opened === undefined) throw new Error('The module switch has no signed-in people.');
  return opened;
}

const switchAdmin = (module: string, enabled: boolean) =>
  switchTo(world().b.admin, second.accounts.admin, module, enabled);

/** The routes of a module as a title says it: its count, or that it has none yet. */
function describeRoutes(id: SwitchableModuleId): string {
  const count = grouped.get(id)?.length ?? 0;
  return `${modules[id].label} (${count === 0 ? 'no routes yet' : `${String(count)} routes`})`;
}

/** The link a module has in the console navigation, named by label. */
function sectionLink(id: SwitchableModuleId): string[] {
  return [modules[id].label, ...(fixture.console.extraLinks[id] ?? [])];
}

test.describe('modules switch off and on, one module at a time', () => {
  test.beforeAll(async () => {
    test.setTimeout(300_000);
    opened = await openWorld();
    await restoreSeeded(world().b.admin, second.accounts.admin);
  });

  test.afterAll(async () => {
    if (opened === undefined) return;
    try {
      await restoreSeeded(opened.b.admin, second.accounts.admin);
    } finally {
      await closeWorld(opened);
    }
  });

  test('the second funder starts with Grants on and the other tools off', async () => {
    const states = await moduleStates(world().b.admin);
    for (const id of switchableModuleIds) {
      expect(states.get(id), id).toBe(fixture.modulesOnAtSeed.includes(id));
    }
    const create = allRoutes().find(({ key }) => key === 'POST /console/programmes');
    expect(create, 'the route list has POST /console/programmes').toBeDefined();
    const made = await sendRoute(
      world().b.manager,
      create ?? { key: '', method: 'POST', idempotent: false },
      '/console/programmes',
      { json: { title: KEPT_TITLE, summary: 'Kept.', description: '', status: 'draft' } },
    );
    expect(made.status, made.text.slice(0, 200)).toBeLessThan(300);
    keptProgrammeId = (made.json as { id: string }).id;
    expect(keptProgrammeId).toMatch(/^[0-9a-f-]{36}$/);
  });

  for (const id of switchableModuleIds.filter(
    (module) => !fixture.modulesOnAtSeed.includes(module),
  )) {
    test(`${describeRoutes(id)}: a tool the seed left off answers 404 before anyone switches it`, async () => {
      expect(await notRefused(world(), grouped.get(id) ?? [])).toEqual([]);
    });
  }

  for (const id of switchableModuleIds) {
    test.describe(describeRoutes(id), () => {
      test('switching off writes one audit event and takes its permissions from the session', async () => {
        await switchAdmin(id, true);
        await switchAdmin(id, false);
        // The session was issued before the switch; it still loses the module at once (ADR 0010).
        const session = await readSession(world().b.admin);
        expect(session.modules ?? []).not.toContain(id);
        expect(session.permissions.filter((name) => name.startsWith(`${id}.`))).toEqual([]);
      });

      test('every route answers 404 with a problem that echoes nothing, whatever the body', async () => {
        const routes = grouped.get(id) ?? [];
        expect(await notRefused(world(), routes)).toEqual([]);
        expect(await notRefused(world(), routes, true)).toEqual([]);
      });

      test('@a11y the console and the portal show no section for it', async ({ pages }) => {
        const page = await pages.staff(second.accounts.admin, slug);
        await axePages(page, [`/${slug}${fixture.console.teamPath}`]);
        const navigation = page.getByRole('navigation', { name: 'Main' });
        for (const name of sectionLink(id)) {
          await expect(navigation.getByRole('link', { name, exact: true }), name).toHaveCount(0);
        }
        await axePages(page, [`/${slug}${fixture.console.paths[id] ?? '/'}`]);
        await expect(h1(page, 'Page not found')).toBeVisible();

        const portal = await pages.applicant(second.accounts.applicant, slug);
        await axePages(portal, [`/${slug}/`]);
        await expect(
          portal.getByRole('main').getByRole('link', { name: modules[id].label, exact: true }),
        ).toHaveCount(0);
      });

      test('switching on brings back its routes and sections, and the data it held', async ({
        pages,
      }) => {
        await switchAdmin(id, true);
        const { b } = world();
        const session = await readSession(b.admin);
        expect(session.modules ?? []).toContain(id);

        // A list route answers for the member who holds its permission. A record route would
        // answer 404 for a missing record, which a switched-off module also does, so it proves nothing here.
        const lists = (grouped.get(id) ?? []).filter(
          (route) =>
            route.method === 'GET' &&
            route.audience !== 'public' &&
            paramsOf(route.path).length === 0 &&
            cases[route.key]?.kind === 'list',
        );
        for (const route of lists) {
          const answer = await callAsSecond(world(), route);
          if (answer !== null) expect(answer.status, route.key).toBe(200);
        }
        if (id === 'grants') {
          const kept = await sendRoute(
            b.manager,
            { key: 'GET programme', method: 'GET', idempotent: false },
            `/console/programmes/${keptProgrammeId}`,
          );
          expect(kept.status).toBe(200);
          expect(kept.text).toContain(KEPT_TITLE);
        }

        const page = await pages.staff(second.accounts.admin, slug);
        await axePages(page, [`/${slug}${fixture.console.teamPath}`]);
        if (session.permissions.some((name) => name.startsWith(`${id}.`))) {
          const [name = ''] = sectionLink(id).slice(id === 'grants' ? 1 : 0);
          await expect(
            page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name, exact: true }),
          ).toBeVisible();
        }
        if (fixture.portalSections.includes(id)) {
          const portal = await pages.applicant(second.accounts.applicant, slug);
          await axePages(portal, [`/${slug}/`]);
          await expect(
            portal.getByRole('main').getByRole('link', { name: modules[id].label, exact: true }),
          ).toBeVisible();
        }
      });
    });
  }

  test('the platform and party keep working with every switchable tool off, and cannot be switched', async () => {
    for (const id of switchableModuleIds) await switchAdmin(id, false);
    const { b } = world();
    const session = await readSession(b.admin);
    expect(session.modules ?? []).toEqual([]);

    const reads = allRoutes().filter(
      ({ module, method, path, audience, contract }) =>
        (module === 'platform' || module === 'party') &&
        method === 'GET' &&
        audience !== 'public' &&
        paramsOf(path).length === 0 &&
        contract !== undefined &&
        contract.stepUp !== true,
    );
    expect(reads.length).toBeGreaterThan(0);
    const refused: string[] = [];
    for (const route of reads) {
      const caller = callerFor(world(), route);
      if (caller === null) continue;
      const answer = await sendRoute(
        caller,
        route,
        pathFor(route, world().fixture, slug),
        callFor(route, world().fixture),
      );
      if (answer.status >= 300) refused.push(`${route.key} answered ${String(answer.status)}`);
    }
    expect(refused).toEqual([]);

    for (const module of ['platform', 'party']) {
      const answer = await b.admin.send('PATCH', '/console/settings/modules', {
        json: { module, enabled: false },
      });
      expect([400, 422], `${module}: ${answer.text.slice(0, 120)}`).toContain(answer.status);
    }
  });
});
