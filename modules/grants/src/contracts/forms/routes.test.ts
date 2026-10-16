// SPDX-License-Identifier: AGPL-3.0-or-later

import { checkRoute } from '@pixel-scientists/domain/api';
import { permissions } from '@pixel-scientists/domain/platform';
import { describe, expect, it } from 'vitest';

import { formVersionSchema } from './answers.ts';
import * as forms from './routes.ts';

const routes = Object.values(forms.formRoutes);

describe('form version routes', () => {
  it('keep every route rule', () => {
    for (const route of routes) expect(checkRoute(route), route.path).toEqual([]);
  });

  it('are all listed in formRoutes', () => {
    const exported = Object.values(forms).filter(
      (value) => typeof value === 'object' && 'audience' in value,
    );
    expect(new Set(exported)).toEqual(new Set(routes));
  });

  it('let staff who manage programmes reach any round in their tenant, and nobody else', () => {
    expect(permissions['grants.programmes.manage']).toMatchObject({ app: 'console' });
    for (const route of routes) {
      expect(route, route.path).toMatchObject({
        audience: 'console',
        module: 'grants',
        permission: 'grants.programmes.manage',
        scope: 'tenant',
      });
    }
  });

  it('list, read, start, save, publish and discard, with a body only for saving', () => {
    expect(routes.map((route) => `${route.method} ${route.path}`)).toEqual([
      'GET /console/rounds/:roundId/form-versions',
      'POST /console/rounds/:roundId/form-versions',
      'GET /console/form-versions/:formVersionId',
      'PUT /console/form-versions/:formVersionId/definition',
      'POST /console/form-versions/:formVersionId/publish',
      'DELETE /console/form-versions/:formVersionId',
    ]);
    expect(routes.filter((route) => 'body' in route)).toEqual([forms.saveFormDraft]);
  });

  it('take strict path parameters', () => {
    for (const route of routes) {
      expect(route.params.safeParse({ roundId: '', formVersionId: '' }).success).toBe(false);
    }
    const id = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';
    expect(forms.getFormVersion.params.safeParse({ formVersionId: id, roundId: id }).success).toBe(
      false,
    );
  });

  it('answer a version with its definition, or none for a draft not yet saved', () => {
    const id = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';
    const draft = {
      id,
      roundId: id,
      version: 1,
      status: 'draft',
      updatedAt: '2027-01-10T09:00:00Z',
      publishedAt: null,
      publishedBy: null,
      definition: null,
    };
    expect(formVersionSchema.parse(draft)).toEqual(draft);
    expect(formVersionSchema.safeParse({ ...draft, status: 'archived' }).success).toBe(false);
    expect(formVersionSchema.safeParse({ ...draft, definition: { sections: [] } }).success).toBe(
      false,
    );
  });
});
