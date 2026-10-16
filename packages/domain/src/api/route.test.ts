// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { fileTypes, MAX_FILE_BYTES } from '../files/types.ts';
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

const attach = {
  method: 'POST',
  path: '/portal/applications/:applicationId/files',
  audience: 'portal',
  module: 'grants',
  summary: 'Attach a file to an application',
  permission: 'grants.applications.apply',
  scope: 'own_application',
  params: z.strictObject({ applicationId: idSchema }),
  body: { raw: ['application/octet-stream'], maxBytes: MAX_FILE_BYTES },
  responses: { 201: z.strictObject({ id: idSchema }) },
} satisfies RouteContract;

const download = {
  method: 'GET',
  path: '/console/files/:fileId',
  audience: 'console',
  module: 'grants',
  summary: 'Download a file',
  permission: 'grants.applications.read',
  scope: 'tenant',
  params: z.strictObject({ fileId: idSchema }),
  responses: { 200: { raw: [...fileTypes] } },
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

describe('checkRoute for raw responses', () => {
  const message = 'Only a public, console or portal GET route answers a raw body.';

  it('passes each content type on its own or together', () => {
    const images = { 200: { raw: ['image/png', 'image/webp'] } };
    expect(problemsWith({ responses: images }, stylesheet)).toEqual([]);
    expect(checkRoute(download)).toEqual([]);
    const portal = {
      path: '/portal/files/:fileId',
      audience: 'portal',
      permission: 'grants.applications.apply',
      scope: 'own_application',
      responses: { 200: { raw: ['application/pdf'] } },
    };
    expect(problemsWith(portal, download)).toEqual([]);
  });

  it('allows a raw body only on public, console and portal GET routes', () => {
    expect(problemsWith({ method: 'DELETE' }, stylesheet)).toContain(message);
    expect(problemsWith({ method: 'DELETE' }, download)).toContain(message);
    const raw = { responses: { 200: { raw: ['text/css'] } } };
    expect(problemsWith({ ...raw, path: '/auth/theme.css', params: undefined }, signOut)).toContain(
      message,
    );
    const auth = { method: 'GET', path: '/auth/file', responses: download.responses };
    expect(problemsWith(auth, signOut)).toContain(message);
  });

  it('lets a public route answer only stylesheets and images, and a console or portal route only file types', () => {
    const pdf = { 200: { raw: ['application/pdf'] } };
    expect(problemsWith({ responses: pdf }, stylesheet)).not.toEqual([]);
    for (const type of ['text/css', 'image/webp', 'image/svg+xml', 'text/html']) {
      const responses = { 200: { raw: [type] } };
      expect(problemsWith({ responses }, download), type).not.toEqual([]);
    }
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

describe('checkRoute for raw upload bodies', () => {
  const message = 'Only a console or portal POST route takes a raw upload body.';

  it('passes a console or portal POST route', () => {
    expect(checkRoute(attach)).toEqual([]);
    const staff = { path: '/console/files', audience: 'console', params: undefined };
    const read = { permission: 'grants.applications.read', scope: 'tenant' };
    expect(problemsWith({ ...staff, ...read }, attach)).toEqual([]);
  });

  it('refuses it on any other method or audience', () => {
    for (const method of ['PUT', 'PATCH']) {
      expect(problemsWith({ method }, attach), method).toContain(message);
    }
    const auth = { ...signOut, body: attach.body };
    expect(checkRoute(auth)).toContain(message);
    const open = { method: 'POST', path: '/public/tenants/:slug/files', body: attach.body };
    expect(problemsWith(open, stylesheet)).toContain(message);
    expect(problemsWith({ method: 'GET' }, attach)).toContain('A GET route takes no body.');
  });

  it('refuses a limit over MAX_FILE_BYTES and any other content type', () => {
    for (const body of [
      { raw: ['application/octet-stream'], maxBytes: MAX_FILE_BYTES + 1 },
      { raw: ['application/pdf'], maxBytes: 1024 },
      { raw: ['text/css'] },
    ]) {
      expect(problemsWith({ body }, attach), JSON.stringify(body)).not.toEqual([]);
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
