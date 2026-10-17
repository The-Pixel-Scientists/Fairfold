// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';

import { call, type Fetch, type JsonRouteContract } from '../api/index.ts';
import { checkRoute } from '../api/route.ts';
import * as warehouse from './index.ts';

describe('warehouse routes', () => {
  it('keep every route rule, and are all listed in warehouseRoutes', () => {
    const exported = Object.values(warehouse).filter(
      (value) => typeof value === 'object' && 'audience' in value,
    );
    expect(exported).toEqual(Object.values(warehouse.warehouseRoutes));
    for (const route of exported) expect(checkRoute(route), route.path).toEqual([]);
  });

  it('answer the snapshot as a SQL load script, to tenant admins with the warehouse permission', () => {
    expect(warehouse.getWarehouseSnapshot).toMatchObject({
      method: 'GET',
      path: '/console/warehouse/snapshot',
      audience: 'console',
      module: 'platform',
      permission: 'platform.warehouse.export',
      scope: 'tenant',
      responses: { 200: { raw: ['application/sql'] } },
    });
    expect(warehouse.MAX_SNAPSHOT_BYTES).toBe(50 * 1024 * 1024);
  });

  it('cannot be fetched as JSON through call()', async () => {
    const fetch = vi.fn<Fetch>();
    await expect(
      call(warehouse.getWarehouseSnapshot as unknown as JsonRouteContract, {}, { fetch }),
    ).rejects.toThrow(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });
});
