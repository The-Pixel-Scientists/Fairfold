// SPDX-License-Identifier: AGPL-3.0-or-later

import { checkRoute } from '@pixel-scientists/domain/api';
import { describe, expect, it } from 'vitest';

import * as spread from './spread.ts';

const routes = Object.values(spread.spreadRoutes);
const ID = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';

describe('score spread routes', () => {
  it('keep every route rule, for members who assign reviews', () => {
    for (const route of routes) {
      expect(checkRoute(route), route.path).toEqual([]);
      expect(route, route.path).toMatchObject({
        audience: 'console',
        module: 'grants',
        permission: 'grants.reviews.assign',
        scope: 'tenant',
        method: 'GET',
      });
    }
    expect(routes.map((route) => route.path)).toEqual([
      '/console/rounds/:roundId/score-spread',
      '/console/submissions/:submissionId/scores',
    ]);
  });

  it('are all listed in spreadRoutes', () => {
    const exported = Object.values(spread).filter(
      (value) => typeof value === 'object' && 'audience' in value,
    );
    expect(new Set(exported)).toEqual(new Set(routes));
  });

  it('have a row per submission and stage, with no figures until a review is submitted', () => {
    const row = {
      submissionId: ID,
      organisation: { id: ID, name: 'Northfield Community Trust' },
      stage: { id: ID, name: 'Review' },
      assigned: 2,
      submitted: 0,
      totals: [],
      lowest: null,
      highest: null,
      range: null,
      mean: null,
    };
    expect(spread.scoreSpreadSchema.parse({ submissions: [row] })).toEqual({ submissions: [row] });
  });
});
