// SPDX-License-Identifier: AGPL-3.0-or-later

import { checkRoute } from '@pixel-scientists/domain/api';
import { describe, expect, it } from 'vitest';

import * as routes from './routes.ts';

const exportRoutes = Object.values(routes.exportRoutes);

describe('export routes', () => {
  it('keep every route rule, and are all listed in exportRoutes', () => {
    const exported = Object.values(routes).filter(
      (value) => typeof value === 'object' && 'audience' in value,
    );
    expect(new Set(exported)).toEqual(new Set(exportRoutes));
    for (const route of exportRoutes) expect(checkRoute(route), route.path).toEqual([]);
  });

  it('need the export permission over the whole tenant in the console', () => {
    for (const route of exportRoutes) {
      expect(route).toMatchObject({
        audience: 'console',
        module: 'grants',
        permission: 'grants.data.export',
        scope: 'tenant',
      });
    }
  });

  it('read and save the publisher details, and export a programme or round as JSON', () => {
    expect(routes.getPublisherSetting).toMatchObject({
      method: 'GET',
      path: '/console/exports/360giving/publisher',
    });
    expect(routes.savePublisherSetting).toMatchObject({
      method: 'PUT',
      path: '/console/exports/360giving/publisher',
    });
    expect(routes.get360GivingExport).toMatchObject({
      method: 'GET',
      path: '/console/exports/360giving',
    });
  });
});
