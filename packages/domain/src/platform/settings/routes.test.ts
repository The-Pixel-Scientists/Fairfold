// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { checkRoute } from '../../api/route.ts';
import { isRawBody } from '../../api/schema-rules.ts';
import * as settings from './routes.ts';

const consoleRoutes = Object.values(settings.settingsRoutes);
const publicRoutes = Object.values(settings.publicTenantRoutes);

describe('settings and public tenant routes', () => {
  it('keep every route rule', () => {
    for (const route of [...consoleRoutes, ...publicRoutes]) {
      expect(checkRoute(route), route.path).toEqual([]);
    }
  });

  it('are all listed in settingsRoutes or publicTenantRoutes', () => {
    const exported = Object.values(settings).filter(
      (value) => typeof value === 'object' && 'audience' in value,
    );
    expect(new Set(exported)).toEqual(new Set([...consoleRoutes, ...publicRoutes]));
  });

  it('need the settings permission over the whole tenant in the console', () => {
    for (const route of consoleRoutes) {
      expect(route).toMatchObject({
        audience: 'console',
        permission: 'platform.settings.manage',
        scope: 'tenant',
      });
    }
  });

  it('match the reviewed list of routes without a permission', () => {
    const lines = publicRoutes.map((route) => {
      const types = Object.values(route.responses).map((body) =>
        isRawBody(body) ? body.raw.join(', ') : 'application/json',
      );
      return `${route.method} ${route.path} (${types.join('; ')})`;
    });
    expect(lines).toEqual([
      'GET /public/tenants/:slug (application/json)',
      'GET /public/tenants/:slug/theme.css (text/css)',
      'GET /public/tenants/:slug/logo (image/png, image/webp)',
    ]);
  });

  it('name the tenant only by the :slug of a public path', () => {
    for (const route of consoleRoutes) expect(route.path).not.toContain(':');
    for (const route of publicRoutes) expect(Object.keys(route.params.shape)).toEqual(['slug']);
  });
});
