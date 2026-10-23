// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Walks the route contracts with a signed-in session, naming records that are
// not the caller's, and reports each answer that is not a refusal.

import { permissionsFor, type Role } from '../../packages/domain/src/platform/roles.ts';
import type { Answer, Api } from '../support/api.ts';
import { keyOf, memberRoutes, type MemberRoute } from '../support/contracts.ts';
import { cases, type Fixture, type Named } from './cases.ts';
import type { Side, World } from './world.ts';

export interface Finding {
  who: string;
  route: string;
  status: number;
  wanted: string;
}

/** The roles of the persona of each name on a side. */
const ROLES: Record<keyof Side, Role> = {
  admin: 'tenant_admin',
  manager: 'programme_manager',
  reviewer: 'reviewer',
  applicant: 'applicant',
};

export const personas = Object.keys(ROLES) as (keyof Side)[];

/** Whether the persona's role gives the route's permission. */
export function holds(name: keyof Side, route: MemberRoute): boolean {
  const app = name === 'applicant' ? 'portal' : 'console';
  return permissionsFor([ROLES[name]], app).includes(route.permission);
}

/** The persona on a side whose role gives the route's permission, if there is one. */
export function holderOn(side: Side, route: MemberRoute): { name: keyof Side; api: Api } | null {
  const name = personas.find((candidate) => holds(candidate, route));
  return name === undefined ? null : { name, api: side[name] };
}

/** The path with its `:name` segments filled in. */
function pathOf(route: MemberRoute, named: Named): string {
  return route.path.replace(/:(\w+)/g, (_, name: string) => {
    const value = named.params?.[name];
    if (value === undefined) throw new Error(`${keyOf(route)} needs a value for ${name}.`);
    return encodeURIComponent(value);
  });
}

export function call(api: Api, route: MemberRoute, fixture: Fixture): Promise<Answer> {
  const entry = cases[keyOf(route)];
  if (entry === undefined || entry.kind === 'own') throw new Error(`${keyOf(route)} has no call.`);
  const named = entry.call(fixture);
  return api.send(route.method, pathOf(route, named), {
    query: named.query,
    json: named.json,
    file: named.file,
  });
}

/** The first funder's markers found in an answer, leaving out any the request itself carried. */
export function leaksIn(answer: Answer, markers: readonly string[], request: string): string[] {
  return markers.filter((marker) => answer.text.includes(marker) && !request.includes(marker));
}

/** The member routes with a case, by kind, and every route that has none. */
export function sorted(): {
  record: MemberRoute[];
  list: MemberRoute[];
  own: MemberRoute[];
  missing: string[];
} {
  const result = {
    record: [] as MemberRoute[],
    list: [] as MemberRoute[],
    own: [] as MemberRoute[],
    missing: [] as string[],
  };
  const routes = memberRoutes();
  for (const route of routes) {
    const entry = cases[keyOf(route)];
    if (entry === undefined) result.missing.push(keyOf(route));
    else result[entry.kind].push(route);
  }
  const known = new Set(routes.map(keyOf));
  result.missing.push(
    ...Object.keys(cases)
      .filter((key) => !known.has(key))
      .map((key) => `${key} (no such route)`),
  );
  return result;
}

/**
 * Calls every record and list route as the person who holds its permission on
 * `side`, with the first funder's ids. A record route must answer 404, and a
 * list route 404 or an answer with nothing of the first funder's in it.
 */
export async function walkSide(
  world: World,
  side: Side,
  label: string,
  include: (route: MemberRoute) => boolean = () => true,
): Promise<{ findings: Finding[]; called: number }> {
  const findings: Finding[] = [];
  let called = 0;
  const { record, list } = sorted();
  for (const route of [...record, ...list].filter(include)) {
    const holder = holderOn(side, route);
    if (holder === null) continue;
    const entry = cases[keyOf(route)];
    const named = entry?.kind === 'own' || entry === undefined ? {} : entry.call(world.fixture);
    const answer = await call(holder.api, route, world.fixture);
    called += 1;
    const who = `${label} ${holder.name}`;
    const request = `${pathOf(route, named)}${JSON.stringify(named.query ?? {})}`;
    const leaked = leaksIn(answer, world.markers, request);
    if (leaked.length > 0) {
      findings.push({
        who,
        route: keyOf(route),
        status: answer.status,
        wanted: `no ${leaked.join(', ')}`,
      });
    } else if (entry?.kind === 'record' && answer.status !== 404) {
      findings.push({ who, route: keyOf(route), status: answer.status, wanted: '404' });
    } else if (entry?.kind === 'list' && ![200, 404].includes(answer.status)) {
      findings.push({ who, route: keyOf(route), status: answer.status, wanted: '200 or 404' });
    }
  }
  return { findings, called };
}
