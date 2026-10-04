// SPDX-License-Identifier: AGPL-3.0-or-later

import { reservedSlugs } from '@pixel-scientists/domain/platform';
import { describe, expect, it } from 'vitest';

import { topLevelRoutes } from './App.tsx';
import { tenantSlugOf } from './tenant.ts';

describe('tenantSlugOf', () => {
  it('reads the funder from the first segment', () => {
    expect(tenantSlugOf('/northfield')).toBe('northfield');
    expect(tenantSlugOf('/northfield/')).toBe('northfield');
    expect(tenantSlugOf('/northfield/sign-in')).toBe('northfield');
    expect(tenantSlugOf('/east-mere-2/programmes/1')).toBe('east-mere-2');
  });

  it('finds no funder at the root, or in anything that is not a slug', () => {
    for (const path of [
      '/',
      '',
      '/Northfield',
      '/ab',
      '/north_field',
      '/%6eorthfield',
      '/9lives',
    ]) {
      expect(tenantSlugOf(path), path).toBeNull();
    }
  });

  it('finds no funder in a name the console uses for itself', () => {
    for (const path of ['/dev/components', '/api/session', '/assets/app.js', '/console', '/auth']) {
      expect(tenantSlugOf(path), path).toBeNull();
    }
  });
});

describe('the console routes outside a funder', () => {
  it('start with a reserved name, so no funder can take the slug and shadow the page', () => {
    const paths = topLevelRoutes.map((route) => route.path);
    // The development build has the gallery, so this test sees `dev`.
    expect(paths).toContain('/dev/components');
    for (const path of paths) {
      const [first] = path.split('/').filter((segment) => segment !== '');
      if (first !== undefined) expect(reservedSlugs, path).toContain(first);
    }
  });
});
