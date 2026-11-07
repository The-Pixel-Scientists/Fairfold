// SPDX-License-Identifier: AGPL-3.0-or-later

import { checkRoute } from '@pixel-scientists/domain/api';
import { describe, expect, it } from 'vitest';

import { triageMessages } from '../triage/messages.ts';
import * as views from './routes.ts';
import { MAX_VIEW_COLUMNS, savedViewSchema, viewInputSchema } from './schemas.ts';

const routes = Object.values(views.savedViewRoutes);
const ID = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';

const view = {
  name: ' Late in round 2 ',
  filter: { roundId: ID, late: true, ownerId: null },
  sort: { by: 'submittedAt', direction: 'desc' },
  columns: [
    { kind: 'column', id: 'organisation' },
    { kind: 'answer', fieldId: 'f_budget' },
  ],
} as const;

describe('saved view routes', () => {
  it('keep every route rule and are all listed in savedViewRoutes', () => {
    for (const route of routes) expect(checkRoute(route), route.path).toEqual([]);
    const exported = Object.values(views).filter(
      (value) => typeof value === 'object' && 'audience' in value,
    );
    expect(new Set(exported)).toEqual(new Set(routes));
  });

  it('are shared by every member who reads applications in the tenant', () => {
    expect(routes.map((route) => `${route.method} ${route.path}`)).toEqual([
      'GET /console/saved-views',
      'GET /console/saved-views/:viewId',
      'POST /console/saved-views',
      'PUT /console/saved-views/:viewId',
      'DELETE /console/saved-views/:viewId',
    ]);
    for (const route of routes) {
      expect(route, route.path).toMatchObject({
        audience: 'console',
        module: 'grants',
        permission: 'grants.applications.read',
        scope: 'tenant',
      });
    }
    expect(views.createSavedView.idempotent).toBe(true);
  });
});

describe('a saved view', () => {
  it('is a name, filters, a sort and columns by id', () => {
    expect(viewInputSchema.parse(view)).toEqual({ ...view, name: 'Late in round 2' });
  });

  it('stores no resolved ids, free-text paths, search text or creator', () => {
    for (const extra of ['submissionIds', 'createdBy', 'tenantId', 'search']) {
      expect(viewInputSchema.safeParse({ ...view, [extra]: [ID] }).success, extra).toBe(false);
    }
    for (const filter of [{ search: 'Trust' }, { cursor: 'abc' }, { late: 'true' }]) {
      expect(viewInputSchema.safeParse({ ...view, filter }).success).toBe(false);
    }
    for (const column of [
      'organisation',
      { kind: 'column', id: 'contact.email' },
      { kind: 'answer', fieldId: 'answers.budget' },
      { kind: 'answer', fieldId: 'f_budget', label: 'Budget' },
    ]) {
      expect(viewInputSchema.safeParse({ ...view, columns: [column] }).success).toBe(false);
    }
  });

  it('shows each column once, at least one and at most the cap', () => {
    const column = { kind: 'answer', fieldId: 'f_budget' };
    expect(
      viewInputSchema.safeParse({ ...view, columns: [column, column] }).error?.issues[0]?.message,
    ).toBe(triageMessages.columnOnce);
    expect(viewInputSchema.safeParse({ ...view, columns: [] }).success).toBe(false);
    const many = Array.from({ length: MAX_VIEW_COLUMNS + 1 }, (_, i) => ({
      kind: 'answer',
      fieldId: `f_${i}`,
    }));
    expect(viewInputSchema.safeParse({ ...view, columns: many }).success).toBe(false);
  });

  it('needs a name on one line', () => {
    expect(viewInputSchema.safeParse({ ...view, name: ' ' }).error?.issues[0]?.message).toBe(
      triageMessages.viewName,
    );
    expect(viewInputSchema.safeParse({ ...view, name: 'Late\nviews' }).success).toBe(false);
  });

  it('names its creator and holds no other personal data', () => {
    const answer = {
      ...viewInputSchema.parse(view),
      id: ID,
      createdBy: { membershipId: ID, name: 'Sam Patel' },
      createdAt: '2026-12-02T10:00:00Z',
      updatedAt: '2026-12-02T10:00:00Z',
    };
    expect(savedViewSchema.parse(answer)).toEqual(answer);
    const leaked = { ...answer, createdBy: { ...answer.createdBy, email: 'sam@example.org' } };
    expect(savedViewSchema.safeParse(leaked).success).toBe(false);
  });
});
