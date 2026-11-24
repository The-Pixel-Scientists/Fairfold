// SPDX-License-Identifier: AGPL-3.0-or-later

import { insightRoutes } from '@pixel-scientists/insight/contracts';
import { describe, expect, it } from 'vitest';

import { moduleDependencies } from '../modules.ts';
import { insightComposition } from './insight.ts';

/** Preparing a publication waits on its queue, its sources and a file the worker may store. */
const unregistered = ['preparePublicationRun'] as const;

const names = (composition: ReturnType<typeof insightComposition>) =>
  (composition.routes ?? []).map(({ contract }) => `${contract.method} ${contract.path}`).sort();

describe('the insight composition', () => {
  it('registers every insight route that has a handler, and no other', () => {
    const wanted = Object.entries(insightRoutes)
      .filter(([name]) => !(unregistered as readonly string[]).includes(name))
      .map(([, { method, path }]) => `${method} ${path}`)
      .sort();

    expect(names(insightComposition(moduleDependencies({})))).toEqual(wanted);
  });

  it('serves each route to the console only, under a permission of its own module', () => {
    for (const { contract } of insightComposition(moduleDependencies({})).routes ?? []) {
      expect(contract.audience).toBe('console');
      expect(contract.module).toBe('insight');
      expect(contract.permission).toMatch(/^insight\./);
    }
  });

  it('supplies no job, since the preparation job is not built', () => {
    expect(insightComposition(moduleDependencies({})).jobs).toBeUndefined();
  });
});
