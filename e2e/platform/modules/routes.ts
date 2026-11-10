// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The route walker: every console, portal and public route of every module,
// read from the committed OpenAPI document (grouped by the module whose label
// is the operation's tag) and from the route contracts the document does not
// list yet, with its path parameters filled from the tenant fixture. A route
// whose parameter the fixture does not name fails by name, so a new route
// forces a fixture update instead of going untested.

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { APIRequestContext } from '@playwright/test';

import {
  moduleIds,
  modules,
  type ModuleId,
} from '../../../packages/domain/src/platform/modules.ts';
import { expect } from '../../../scripts/e2e/fixtures.ts';
import { cases, type Fixture } from '../../isolation/cases.ts';
import type { Answer, Api, Call } from '../../support/api.ts';
import type { Slug } from '../../support/env.ts';
import { keyOf, memberRoutes, type MemberRoute } from '../../support/contracts.ts';

/** A well-formed id no record has, for a route whose record the seed does not make; the answer must still be a refusal. */
export const ABSENT_ID = '00000000-0000-4000-8000-000000000000';

const AUDIENCES = ['console', 'portal', 'public'] as const;

export type RouteAudience = (typeof AUDIENCES)[number];

export interface ModuleRoute {
  /** `GET /console/programmes/:programmeId`, as the isolation cases name a route. */
  key: string;
  method: string;
  path: string;
  module: ModuleId;
  audience: RouteAudience;
  idempotent: boolean;
  /** The route contract, for the permission; absent for a route only the document lists. */
  contract: MemberRoute | undefined;
}

interface Operation {
  tags?: string[];
  parameters?: { name: string; in: string }[];
}

export interface OpenApiDocument {
  paths: Record<string, Record<string, Operation>>;
}

interface TenantFixture {
  tenants: {
    a: { slug: Slug; name: string };
    b: {
      slug: Slug;
      name: string;
      accounts: { admin: string; manager: string; reviewer: string; applicant: string };
    };
  };
  modulesOnAtSeed: string[];
  portalSections: string[];
  pathParams: Record<string, string>;
  console: {
    teamPath: string;
    paths: Record<string, string>;
    extraLinks: Record<string, string[]>;
  };
}

export const fixture = JSON.parse(
  readFileSync(join(process.cwd(), 'test/fixtures/tenants/tenants.json'), 'utf8'),
) as TenantFixture;

export function readDocument(): OpenApiDocument {
  return JSON.parse(
    readFileSync(join(process.cwd(), 'apps/api/openapi.json'), 'utf8'),
  ) as OpenApiDocument;
}

/** Module ids by label; two modules sharing a label fail. */
export function moduleByLabel(
  table: Record<string, { label: string }> = modules,
): Map<string, string> {
  const found = new Map<string, string>();
  for (const [id, { label }] of Object.entries(table)) {
    const other = found.get(label);
    if (other !== undefined) {
      throw new Error(`The modules ${other} and ${id} share the label ${label}.`);
    }
    found.set(label, id);
  }
  return found;
}

/** The document's console, portal and public operations; one whose tag is no module's label fails. */
export function documentRoutes(document: OpenApiDocument = readDocument()): ModuleRoute[] {
  const byLabel = moduleByLabel();
  const contracts = new Map(memberRoutes().map((route) => [keyOf(route), route]));
  const found: ModuleRoute[] = [];
  for (const [template, operations] of Object.entries(document.paths)) {
    const audience = AUDIENCES.find((candidate) => template.startsWith(`/${candidate}/`));
    if (audience === undefined) continue;
    const path = template.replace(/\{(\w+)\}/g, ':$1');
    for (const [verb, operation] of Object.entries(operations)) {
      const method = verb.toUpperCase();
      const key = `${method} ${path}`;
      const tags = operation.tags ?? [];
      const module = tags.map((tag) => byLabel.get(tag)).find((id) => id !== undefined);
      if (module === undefined || !moduleIds.includes(module as ModuleId)) {
        throw new Error(`${key} has the tags [${tags.join(', ')}], which match no module label.`);
      }
      found.push({
        key,
        method,
        path,
        module: module as ModuleId,
        audience,
        idempotent: (operation.parameters ?? []).some(
          ({ name, in: place }) => place === 'header' && name.toLowerCase() === 'idempotency-key',
        ),
        contract: contracts.get(key),
      });
    }
  }
  return found;
}

/** The console and portal contracts, as module routes. */
function contractRoutes(): ModuleRoute[] {
  return memberRoutes().map((contract) => ({
    key: keyOf(contract),
    method: contract.method,
    path: contract.path,
    module: contract.module,
    audience: contract.audience,
    idempotent: (contract as { idempotent?: true }).idempotent === true,
    contract,
  }));
}

/** The document's routes, then any contract route the document lacks. */
export function allRoutes(document: OpenApiDocument = readDocument()): ModuleRoute[] {
  const listed = documentRoutes(document);
  const keys = new Set(listed.map(({ key }) => key));
  return [...listed, ...contractRoutes().filter(({ key }) => !keys.has(key))];
}

/** Every module's routes, with an empty list for a module that has none yet. */
export function routesByModule(
  routes: readonly ModuleRoute[] = allRoutes(),
): Map<ModuleId, ModuleRoute[]> {
  return new Map(moduleIds.map((id) => [id, routes.filter(({ module }) => module === id)]));
}

export const paramsOf = (path: string): string[] =>
  [...path.matchAll(/:(\w+)/g)].map(([, name]) => name ?? '');

/** The path with each `:name` filled from the fixture; an unmapped parameter fails naming the route. */
export function pathFor(
  route: Pick<ModuleRoute, 'key' | 'path'>,
  ids: Record<string, string>,
  slug: string,
): string {
  return route.path.replace(/:(\w+)/g, (_, name: string) => {
    const source = fixture.pathParams[name];
    if (source === undefined) {
      throw new Error(`${route.key} has no fixture value for the path parameter ${name}.`);
    }
    const value = source === '@slug' ? slug : source === '@absent' ? ABSENT_ID : ids[source];
    if (value === undefined) {
      throw new Error(`${route.key}: the fixture has no ${source} for the path parameter ${name}.`);
    }
    return encodeURIComponent(value);
  });
}

/** The query and body the isolation cases give a route, or an empty object where a write needs a body. */
export function callFor(route: ModuleRoute, ids: Fixture): Call {
  const entry = cases[route.key];
  if (entry !== undefined && entry.kind !== 'own') {
    const { query, json, file } = entry.call(ids);
    return { query, json, file };
  }
  return ['POST', 'PUT', 'PATCH'].includes(route.method) ? { json: {} } : {};
}

const RETRY_CAP_SECONDS = 120;

function retryAfterMs(answer: Answer): number {
  const seconds = Number(answer.headers['retry-after']);
  return Math.min(Number.isFinite(seconds) && seconds > 0 ? seconds : 1, RETRY_CAP_SECONDS) * 1000;
}

/** Repeats a call once after `Retry-After`; a second 429 fails, so a refusal is never counted as a pass. */
export async function paced(label: string, send: () => Promise<Answer>): Promise<Answer> {
  let answer = await send();
  if (answer.status === 429) {
    await new Promise((resolve) => setTimeout(resolve, retryAfterMs(answer)));
    answer = await send();
    expect(answer.status, `${label} was rate limited twice`).not.toBe(429);
  }
  return answer;
}

/** Sends a route's call, with a fresh `Idempotency-Key` where the route declares one. */
export function sendRoute(
  api: Api,
  route: Pick<ModuleRoute, 'key' | 'method' | 'idempotent'>,
  path: string,
  call: Call = {},
): Promise<Answer> {
  return paced(route.key, async () => {
    if (!route.idempotent) return api.send(route.method, path, call);
    // Api.send takes no headers; the session's own request context sends the key.
    const context = Reflect.get(api, 'context') as APIRequestContext;
    const response = await context.fetch(`/api${path}`, {
      method: route.method,
      params: call.query,
      data: call.json,
      headers: { 'idempotency-key': randomUUID() },
      failOnStatusCode: false,
      maxRedirects: 0,
    });
    const bytes = await response.body();
    const text = bytes.toString('utf8');
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: response.status(), json, text, bytes, headers: response.headers() };
  });
}
