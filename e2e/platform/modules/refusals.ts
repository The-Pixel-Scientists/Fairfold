// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Calls a module's routes as the second funder's people and reports the
// answers that are not what a switched-off module gives.

import { Api, type Answer } from '../../support/api.ts';
import { consoleOrigin } from '../../support/env.ts';
import { holderOn } from '../../isolation/walk.ts';
import type { World } from '../../isolation/world.ts';
import { callFor, fixture, pathFor, sendRoute, type ModuleRoute } from './routes.ts';

/** The person of the second funder who calls a route, or null when no one there holds its permission. */
export function callerFor(world: World, route: ModuleRoute): Api | null {
  if (route.audience === 'portal') return world.b.applicant;
  if (route.contract !== undefined) return holderOn(world.b, route.contract)?.api ?? null;
  return route.audience === 'console' ? world.b.admin : null;
}

/** Calls a route as the second funder, naming the first funder's ids in the path, body and query. */
export async function callAsSecond(
  world: World,
  route: ModuleRoute,
  emptyBody = false,
): Promise<Answer | null> {
  const path = pathFor(route, world.fixture, fixture.tenants.b.slug);
  const call = emptyBody ? { json: {} } : callFor(route, world.fixture);
  if (route.audience === 'public') {
    const visitor = await Api.open(consoleOrigin);
    try {
      return await sendRoute(visitor, route, path, call);
    } finally {
      await visitor.dispose();
    }
  }
  const api = callerFor(world, route);
  return api === null ? null : sendRoute(api, route, path, call);
}

/** What a 404 for a switched-off module must not repeat. */
function echoes(world: World, route: ModuleRoute, answer: Answer): string[] {
  const names = [
    pathFor(route, world.fixture, fixture.tenants.b.slug),
    fixture.tenants.a.slug,
    fixture.tenants.b.slug,
    fixture.tenants.b.name,
    ...Object.values(world.fixture),
  ];
  return names.filter((name) => answer.text.includes(name));
}

/**
 * Every route that does not answer a plain 404 problem for a module switched
 * off; empty when all do. With `emptyBody`, a write sends an empty object, so
 * a module that is off must win over validation.
 */
export async function notRefused(
  world: World,
  routes: readonly ModuleRoute[],
  emptyBody = false,
): Promise<string[]> {
  const problems: string[] = [];
  for (const route of routes.filter(({ method }) => !emptyBody || method !== 'GET')) {
    const answer = await callAsSecond(world, route, emptyBody);
    if (answer === null) continue;
    if (answer.status !== 404) {
      problems.push(`${route.key} answered ${String(answer.status)}, wanted 404`);
    } else if (!(answer.headers['content-type'] ?? '').includes('application/problem+json')) {
      problems.push(`${route.key} answered 404 without a problem body`);
    } else {
      const repeated = echoes(world, route, answer);
      if (repeated.length > 0) problems.push(`${route.key} echoed ${repeated.join(', ')}`);
    }
  }
  return problems;
}
