// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The route walker's own checks: it reads the committed OpenAPI document,
// groups every route by module, and refuses what it cannot place or fill.
// These read files only and need no signed-in person.

import { switchableModuleIds, modules } from '../../../packages/domain/src/platform/modules.ts';
import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import { keyOf, memberRoutes } from '../../support/contracts.ts';
import {
  allRoutes,
  documentRoutes,
  moduleByLabel,
  paramsOf,
  pathFor,
  readDocument,
  routesByModule,
  fixture,
} from './routes.ts';

test.describe('the module route walk', () => {
  test('fails on an operation whose tag is no module’s label, naming the route', () => {
    const document = {
      paths: { '/console/things/{thingId}': { get: { tags: ['No such tool'] } } },
    };
    expect(() => documentRoutes(document)).toThrow(/GET \/console\/things\/:thingId/);
  });

  test('fails when two modules share a label, naming both', () => {
    expect(() => moduleByLabel({ one: { label: 'Same' }, two: { label: 'Same' } })).toThrow(
      /one and two share the label Same/,
    );
    expect(() => moduleByLabel()).not.toThrow();
  });

  test('fails on a path parameter the fixture does not name, with the route and parameter', () => {
    const route = { key: 'GET /console/things/:thingId', path: '/console/things/:thingId' };
    expect(() => pathFor(route, {}, 'eastmoor')).toThrow(
      /GET \/console\/things\/:thingId.*thingId/,
    );
  });

  test('fills a public route’s slug and encodes values', () => {
    const route = { key: 'GET /public/tenants/:slug', path: '/public/tenants/:slug' };
    expect(pathFor(route, {}, 'eastmoor')).toBe('/public/tenants/eastmoor');
  });

  test('the fixture names every path parameter of every route', () => {
    const unmapped = allRoutes().flatMap((route) =>
      paramsOf(route.path)
        .filter((name) => fixture.pathParams[name] === undefined)
        .map((name) => `${route.key}: ${name}`),
    );
    expect(unmapped).toEqual([]);
  });

  test('groups routes under every switchable module, reporting those with none', () => {
    const byModule = routesByModule();
    for (const id of switchableModuleIds) expect(byModule.has(id), id).toBe(true);
    const titles = switchableModuleIds.map(
      (id) => `${modules[id].label}: ${String(byModule.get(id)?.length ?? 0)} routes`,
    );
    test.info().annotations.push({ type: 'routes per module', description: titles.join('; ') });
    expect(byModule.get('grants')?.length).toBeGreaterThan(0);
  });

  test('the document lists every console and portal contract route', () => {
    test.fail(
      readDocument().paths['/console/programmes'] === undefined,
      'apps/api/openapi.json lists only the health routes while the document fails to build with the modules’ routes.',
    );
    const listed = new Set(documentRoutes().map(({ key }) => key));
    const missing = memberRoutes()
      .map(keyOf)
      .filter((key) => !listed.has(key));
    expect(missing).toEqual([]);
  });
});
