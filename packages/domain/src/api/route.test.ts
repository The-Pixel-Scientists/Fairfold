// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { fileTypes, MAX_FILE_BYTES } from '../files/types.ts';
import { idSchema } from '../id.ts';
import { slugSchema } from '../platform/tenant.ts';
import {
  checkRoute,
  defineRoute,
  idempotencyHeadersSchema,
  idempotencyKeySchema,
  type RouteContract,
} from './route.ts';

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
  idempotent: true,
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

  it('lets only a console route answer an export, such as a SQL load script', () => {
    const sql = { 200: { raw: ['application/sql'] } };
    expect(problemsWith({ responses: sql }, download)).toEqual([]);
    const portal = {
      path: '/portal/files/:fileId',
      audience: 'portal',
      permission: 'grants.applications.apply',
      scope: 'own_application',
      responses: sql,
    };
    expect(problemsWith(portal, download)).not.toEqual([]);
    expect(problemsWith({ responses: sql }, stylesheet)).not.toEqual([]);
    expect(problemsWith({ method: 'DELETE', responses: sql }, download)).toContain(
      'Only a public, console or portal GET route answers a raw body.',
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

describe('checkRoute for idempotency (ADR 0028)', () => {
  const create = {
    ...valid,
    method: 'POST',
    path: '/console/programmes',
    params: undefined,
    idempotent: true,
    responses: { 201: z.object({ id: idSchema }) },
  } satisfies RouteContract;
  const missing = 'A POST that creates must be idempotent.';

  it('needs the marker on a POST that answers 201, in every audience but auth', () => {
    expect(checkRoute(create)).toEqual([]);
    expect(problemsWith({ idempotent: undefined }, create)).toEqual([missing]);
    const portal = {
      path: '/portal/x',
      audience: 'portal',
      permission: 'grants.applications.apply',
    };
    expect(problemsWith({ ...portal, idempotent: undefined }, create)).toContain(missing);
    const open = { method: 'POST', path: '/public/tenants/:slug/x', responses: create.responses };
    expect(problemsWith(open, stylesheet)).toContain(missing);
    expect(problemsWith({ ...open, idempotent: true }, stylesheet)).toEqual([]);
    expect(problemsWith({ responses: { 201: z.object({ id: idSchema }) } }, signOut)).toEqual([]);
  });

  it('lets a POST that creates nothing opt in', () => {
    expect(problemsWith({ responses: { 200: z.object({ id: idSchema }) } }, create)).toEqual([]);
    expect(problemsWith({ idempotent: undefined, responses: { 204: null } }, create)).toEqual([]);
  });

  it('refuses the marker on any other method, on an auth route, or as anything but true', () => {
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
      expect(problemsWith({ method, idempotent: true }), method).toContain(
        'Only a POST route is idempotent.',
      );
    }
    expect(problemsWith({ idempotent: true }, signOut)).toEqual([
      'An auth route is never idempotent.',
    ]);
    expect(problemsWith({ idempotent: 'yes' }, create)).toEqual([
      missing,
      'idempotent is true or left out.',
    ]);
  });

  it('refuses the key in any request schema, in any spelling', () => {
    const named = (key: string) => z.strictObject({ [key]: z.uuid() });
    const message = (part: string, key: string) =>
      `${part} names "${key}"; the key travels in the Idempotency-Key header.`;
    for (const key of [
      'idempotencyKey',
      'idempotency_key',
      'IdempotencyKey',
      'requestIdempotencyKey',
    ]) {
      expect(problemsWith({ body: named(key) }, create), key).toContain(message('body', key));
      expect(problemsWith({ query: named(key) }, create), key).toContain(message('query', key));
    }
    const hyphen = 'idempotency-key';
    expect(problemsWith({ query: named(hyphen) }, create)).toContain(message('query', hyphen));
    const params = { path: '/console/things/:idempotencyKey', params: named('idempotencyKey') };
    expect(problemsWith(params, create)).toContain(message('params', 'idempotencyKey'));
    expect(problemsWith({ body: z.strictObject({ tenantId: idSchema }) }, create)).toContain(
      'body names "tenantId"; the acting user and tenant come from the session.',
    );
  });
});

describe('checkRoute for SSO completions (ADR 0010)', () => {
  const callback = {
    ...signOut,
    method: 'GET',
    path: '/auth/tenants/:slug/sso/oidc/callback',
    summary: 'Finish an SSO sign-in',
    session: 'none',
    params: z.strictObject({ slug: slugSchema }),
    query: z.strictObject({ state: z.string() }),
    ssoCompletion: 'oidc_callback',
    responses: { 303: null },
  } satisfies RouteContract;
  const acs = {
    ...callback,
    method: 'POST',
    path: '/auth/tenants/:slug/sso/saml/acs',
    query: undefined,
    body: z.strictObject({ SAMLResponse: z.string(), RelayState: z.string() }),
    ssoCompletion: 'saml_acs',
  } satisfies RouteContract;

  it('passes a bare 303 from an SSO completion, and the ACS form body', () => {
    expect(checkRoute(callback)).toEqual([]);
    expect(checkRoute({ ...callback, ssoCompletion: 'saml_completion' })).toEqual([]);
    expect(checkRoute(acs)).toEqual([]);
  });

  it('refuses a redirect from any other route', () => {
    for (const route of [
      { ...signOut, responses: { 303: null } },
      { ...stylesheet, responses: { 303: null } },
      { ...valid, responses: { 303: null } },
    ] as RouteContract[]) {
      expect(checkRoute(route), route.path).toContain(
        'Response 303 is not a success; errors are always problem details.',
      );
    }
  });

  it('refuses the marker off auth routes, with a session, or with any other answer', () => {
    const bad: [RouteContract, string][] = [
      [{ ...valid, ssoCompletion: 'oidc_callback' } as never, 'Only an auth route'],
      [{ ...callback, ssoCompletion: 'saml_logout' } as never, 'Only an auth route'],
      [{ ...callback, session: 'any' }, 'needs no session'],
      [{ ...callback, responses: { 303: z.object({}) } }, 'answers 303'],
      [{ ...callback, responses: { 302: null } }, 'answers 303'],
      [{ ...callback, responses: { 303: null, 200: z.object({}) } }, 'answers 303'],
      [{ ...callback, method: 'POST' }, 'is a GET'],
      [{ ...acs, method: 'GET', body: undefined }, 'is a POST'],
    ];
    for (const [route, problem] of bad) {
      expect(checkRoute(route).join(' '), problem).toContain(problem);
    }
  });

  it('gives only the ACS a form body, of SAMLResponse and RelayState as required text', () => {
    const form = 'The SAML ACS body is a form of SAMLResponse and RelayState, both text.';
    for (const body of [
      undefined,
      z.strictObject({ SAMLResponse: z.string() }),
      z.strictObject({ SAMLResponse: z.string(), RelayState: z.string().optional() }),
      z.strictObject({ SAMLResponse: z.string(), RelayState: z.string(), next: z.string() }),
      z.strictObject({ SAMLResponse: z.string(), RelayState: z.number() }),
    ]) {
      expect(checkRoute({ ...acs, body })).toContain(form);
    }
    expect(checkRoute({ ...callback, method: 'POST', body: acs.body })).toContain(
      'The oidc_callback route is a GET.',
    );
  });
});

describe('idempotencyKeySchema', () => {
  it('takes a version 4 or 7 uuid in either case, as lower case', () => {
    const v4 = '0b7c4a1e-5d2f-4c8e-9a3b-6f1d2e4c8a90';
    expect(idempotencyKeySchema.parse(v4)).toBe(v4);
    expect(idempotencyKeySchema.parse(v4.toUpperCase())).toBe(v4);
    const v7 = '019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a7b';
    expect(idempotencyKeySchema.parse(v7)).toBe(v7);
  });

  it('refuses anything else', () => {
    for (const key of [
      '',
      '00000000-0000-0000-0000-000000000000',
      'ffffffff-ffff-ffff-ffff-ffffffffffff',
      '0b7c4a1e-5d2f-1c8e-9a3b-6f1d2e4c8a90',
      '0b7c4a1e-5d2f-4c8e-7a3b-6f1d2e4c8a90',
      '{0b7c4a1e-5d2f-4c8e-9a3b-6f1d2e4c8a90}',
      '"0b7c4a1e-5d2f-4c8e-9a3b-6f1d2e4c8a90"',
      '0b7c4a1e5d2f4c8e9a3b6f1d2e4c8a90',
      ' 0b7c4a1e-5d2f-4c8e-9a3b-6f1d2e4c8a90',
    ]) {
      expect(idempotencyKeySchema.safeParse(key).success, key).toBe(false);
    }
  });

  it('shows in the OpenAPI document as a required uuid header', () => {
    expect(z.toJSONSchema(idempotencyHeadersSchema, { io: 'input' })).toMatchObject({
      type: 'object',
      required: ['idempotency-key'],
      properties: { 'idempotency-key': { type: 'string', format: 'uuid' } },
    });
  });
});

// Tests run on Node.js, but this package has no Node.js types: just enough to find the contracts.
const { process } = globalThis as unknown as {
  process: {
    getBuiltinModule(id: 'node:fs'): {
      readdirSync(path: string, options?: { recursive: true }): string[];
      existsSync(path: string): boolean;
    };
  };
};
const { dirname } = import.meta as unknown as { dirname: string };
const fs = process.getBuiltinModule('node:fs');

/** Every entry point of this package, and every module's published contracts, found on disk. */
function contractEntries(): string[] {
  const domain = fs
    .readdirSync(`${dirname}/..`, { recursive: true })
    .map((path) => path.replaceAll('\\', '/'))
    .filter((path) => /(?:^|\/)index\.ts$/.test(path) && !path.includes('__snapshots__'))
    .map((path) => `../${path}`);
  const modules = fs
    .readdirSync(`${dirname}/../../../../modules`)
    .map((name) => `../../../../modules/${name}/src/contracts/index.ts`)
    .filter((path) => fs.existsSync(`${dirname}/${path}`));
  return [...domain, ...modules];
}

function isRoute(value: unknown): value is RouteContract {
  return typeof value === 'object' && value !== null && 'method' in value && 'responses' in value;
}

/** Routes exported as they are, or in a plain object or list such as `authRoutes`. */
function routesIn(values: unknown[], depth = 2): RouteContract[] {
  return values.flatMap((value) => {
    if (isRoute(value)) return [value];
    const plain =
      Array.isArray(value) ||
      (typeof value === 'object' &&
        value !== null &&
        Object.getPrototypeOf(value) === Object.prototype);
    return plain && depth > 0 ? routesIn(Object.values(value as object), depth - 1) : [];
  });
}

describe('every exported route', () => {
  it('keeps the rules, and marks each POST that creates', { timeout: 60_000 }, async () => {
    const routes = new Set<RouteContract>();
    for (const entry of contractEntries()) {
      const exported = (await import(/* @vite-ignore */ entry)) as Record<string, unknown>;
      for (const route of routesIn(Object.values(exported))) routes.add(route);
    }
    const creates: string[] = [];
    for (const route of routes) {
      const id = `${route.method} ${route.path}`;
      expect(checkRoute(route), id).toEqual([]);
      if (route.method === 'POST' && Object.hasOwn(route.responses, 201)) {
        expect(route.idempotent, id).toBe(route.audience === 'auth' ? undefined : true);
        creates.push(id);
      }
    }
    // The create routes at S11-14. A new one is checked above without being listed here.
    expect(creates).toEqual(
      expect.arrayContaining([
        'POST /console/team/invitations',
        'POST /portal/rounds/:roundId/applications',
        'POST /portal/applications/:applicationId/fields/:fieldId/files',
        'POST /console/rounds/:roundId/form-versions',
        'POST /console/programmes',
        'POST /console/programmes/:programmeId/rounds',
        'POST /portal/profile/consents',
        'POST /portal/organisations',
      ]),
    );
  });
});

describe('defineRoute', () => {
  it('returns a valid contract unchanged', () => {
    expect(defineRoute(valid)).toBe(valid);
  });

  it('throws at load for a POST that creates without the marker', () => {
    expect(() => defineRoute({ ...attach, idempotent: undefined })).toThrow(
      'A POST that creates must be idempotent.',
    );
  });

  it('throws with every problem listed', () => {
    expect(() =>
      defineRoute({ ...valid, path: '/console/x', body: z.object({ tenantId: idSchema }) }),
    ).toThrow(/PATCH \/console\/x breaks the route rules:\n- .*\n- /);
  });
});
