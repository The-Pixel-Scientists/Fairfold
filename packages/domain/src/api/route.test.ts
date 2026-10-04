// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { idSchema } from '../id.ts';
import { slugSchema } from '../platform/tenant.ts';
import { checkRoute, defineRoute, type RouteContract } from './route.ts';

/** A route that keeps every rule; each test breaks one. */
const valid = {
  method: 'PATCH',
  path: '/console/programmes/:programmeId',
  audience: 'console',
  module: 'grants',
  summary: 'Change a programme',
  permission: 'grants.programmes.manage',
  scope: 'tenant',
  params: z.strictObject({ programmeId: idSchema }),
  query: z.strictObject({ preview: z.enum(['yes', 'no']).optional() }),
  body: z.strictObject({ title: z.string() }),
  responses: { 200: z.object({ id: idSchema, title: z.string() }) },
} satisfies RouteContract;

const signOut = {
  method: 'POST',
  path: '/auth/sign-out',
  audience: 'auth',
  module: 'platform',
  summary: 'Sign out',
  permission: null,
  scope: null,
  session: 'any',
  responses: { 204: null },
} satisfies RouteContract;

const stylesheet = {
  method: 'GET',
  path: '/public/tenants/:slug/theme.css',
  audience: 'public',
  module: 'platform',
  summary: "Read a tenant's theme stylesheet",
  permission: null,
  scope: null,
  params: z.strictObject({ slug: slugSchema }),
  responses: { 200: { raw: ['text/css'] } },
} satisfies RouteContract;

function problemsWith(change: Record<string, unknown>, route: RouteContract = valid): string[] {
  return checkRoute({ ...route, ...change });
}

describe('checkRoute', () => {
  it('passes routes that keep every rule', () => {
    expect(checkRoute(valid)).toEqual([]);
    expect(checkRoute(signOut)).toEqual([]);
    expect(checkRoute(stylesheet)).toEqual([]);
    expect(problemsWith({ stepUp: true })).toEqual([]);
  });

  it('needs the path to start with the audience, in lower case, with known parts', () => {
    for (const change of [
      { path: '/portal/programmes/:programmeId' },
      { path: '/console' },
      { path: '/console/Programmes/:programmeId' },
      { path: '/console/programmes/{programmeId}' },
      { method: 'TRACE' },
      { module: 'finance' },
      { audience: 'staff' },
      { summary: ' ' },
    ]) {
      expect(problemsWith(change)).not.toEqual([]);
    }
  });

  it('needs params to name exactly the path parameters, each an id', () => {
    const message = 'params must name exactly the path parameters.';
    expect(problemsWith({ params: undefined })).toContain(message);
    const extra = z.strictObject({ programmeId: idSchema, roundId: idSchema });
    expect(problemsWith({ params: extra })).toContain(message);
    const text = z.strictObject({ programmeId: z.string() });
    expect(problemsWith({ params: text })).not.toEqual([]);
  });

  it('applies the access rules', () => {
    expect(problemsWith({ permission: 'grants.reviews.score' })).not.toEqual([]);
    expect(problemsWith({ stepUp: 'yes' })).toContain('stepUp is true or false.');
    expect(problemsWith({ session: 'sometimes' }, signOut)).not.toEqual([]);
  });

  it('takes no body on GET or DELETE', () => {
    expect(problemsWith({ method: 'GET' })).toContain('A GET route takes no body.');
    expect(problemsWith({ method: 'DELETE' })).toContain('A DELETE route takes no body.');
  });

  it('needs a success response, and applies the schema rules to every part', () => {
    expect(problemsWith({ responses: {} })).toContain(
      'The route needs at least one success response.',
    );
    expect(problemsWith({ body: z.strictObject({ tenantId: idSchema }) })).not.toEqual([]);
    expect(problemsWith({ responses: { 200: z.unknown() } })).not.toEqual([]);
  });
});

describe('checkRoute for raw bodies', () => {
  const message = 'Only a public GET route answers a raw body.';

  it('passes each content type on its own or together', () => {
    const images = { 200: { raw: ['image/png', 'image/webp'] } };
    expect(problemsWith({ responses: images }, stylesheet)).toEqual([]);
  });

  it('allows a raw body only on public GET routes', () => {
    expect(problemsWith({ method: 'DELETE' }, stylesheet)).toContain(message);
    const raw = { responses: { 200: { raw: ['text/css'] } } };
    expect(problemsWith({ ...raw, method: 'GET', body: undefined })).toContain(message);
    expect(problemsWith({ ...raw, path: '/auth/theme.css', params: undefined }, signOut)).toContain(
      message,
    );
  });

  it('needs status 200 and content types from the list, each once', () => {
    for (const responses of [
      { 201: { raw: ['text/css'] } },
      { 200: { raw: [] } },
      { 200: { raw: ['text/html'] } },
      { 200: { raw: ['image/svg+xml'] } },
      { 200: { raw: ['text/css', 'text/css'] } },
      { 200: { raw: 'text/css' } },
      { 200: { raw: ['text/css'], schema: z.string() } },
    ]) {
      expect(problemsWith({ responses }, stylesheet), JSON.stringify(responses)).not.toEqual([]);
    }
  });
});

describe('defineRoute', () => {
  it('returns a valid contract unchanged', () => {
    expect(defineRoute(valid)).toBe(valid);
  });

  it('throws with every problem listed', () => {
    expect(() =>
      defineRoute({ ...valid, path: '/console/x', body: z.object({ tenantId: idSchema }) }),
    ).toThrow(/PATCH \/console\/x breaks the route rules:\n- .*\n- /);
  });
});
