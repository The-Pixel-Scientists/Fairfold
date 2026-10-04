// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Stands in for the API in the browser, for specs that run without the stack.
// Answers are plain JSON in the shape of the auth contracts
// (packages/domain/src/auth). The console checks every answer against its
// contract before it uses it, so an answer that drifts from the contract
// shows up as a failing spec.

import type { Page } from '@playwright/test';

export interface Membership {
  id: string;
  tenant: { slug: string; name: string };
}

export const northfield: Membership = {
  id: '0b8f7c1e-7a3d-4c55-9a52-2f6f1a9d4e10',
  tenant: { slug: 'northfield', name: 'Northfield Foundation' },
};

export const eastmere: Membership = {
  id: '5d1c2b9a-3e4f-4a6b-8c7d-9e0f1a2b3c4d',
  tenant: { slug: 'eastmere', name: 'Eastmere Trust' },
};

const programmeManager = [
  'party.records.read',
  'grants.programmes.manage',
  'grants.applications.read',
  'grants.applications.triage',
  'grants.reviews.assign',
  'grants.decisions.record',
  'grants.decisions.release',
];

export interface SessionOptions {
  /** The funder the session works for; null is a signed-in person with no membership in the address. */
  active?: Membership | null;
  memberships?: Membership[];
  permissions?: string[];
  mfa?: 'enrol' | 'verify' | 'complete';
  /** When the session ends, as an ISO date. Defaults to well in the future. */
  expiresAt?: string;
}

export function consoleSession(options: SessionOptions = {}) {
  const {
    active = northfield,
    memberships = [northfield],
    permissions = programmeManager,
  } = options;
  const { mfa = 'complete', expiresAt = '2099-01-01T00:00:00.000Z' } = options;
  const user = { id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d', email: 'ada@example.org' };
  if (mfa !== 'complete') {
    return {
      user,
      expiresAt,
      app: 'console',
      mfa,
      recentAuthUntil: null,
      activeMembership: null,
      memberships: [],
      permissions: [],
    };
  }
  const withRoles = (membership: Membership) => ({ ...membership, roles: ['programme_manager'] });
  return {
    user,
    expiresAt,
    app: 'console',
    mfa,
    recentAuthUntil: null,
    activeMembership: active === null ? null : withRoles(active),
    memberships: memberships.map(withRoles),
    permissions: active === null ? [] : permissions,
  };
}

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/** The API's problem answer (RFC 9457). */
export function problem(
  status: number,
  detail: string,
  errors?: { field: string; message: string }[],
): Reply {
  return {
    status,
    body: {
      type: 'about:blank',
      title: 'Problem',
      status,
      detail,
      requestId: 'req_e2e',
      ...(errors ? { errors } : {}),
    },
  };
}

export const signedOut = problem(401, 'You are not signed in.');

export type Handler = Reply | ((body: unknown) => Reply);

export interface SentRequest {
  /** `POST /auth/sign-out`, without the `/api` prefix. */
  key: string;
  body: unknown;
}

/** The reads every page of a funder's console makes: its name and look, and the stylesheet that look names. */
const PUBLIC_TENANT = /^GET \/public\/tenants\/([a-z0-9-]+)(\/theme\.css)?$/;

/**
 * Answers every request to `/api` from the handlers, keyed like
 * `GET /auth/session`. A request with no handler gets a 404, and shows up in
 * the list this returns, which holds every request sent so far. The reads of
 * the funder's name and look, which every page makes, are the exception: they
 * are answered with the standard look, and left out of the list, unless a
 * handler gives its own answer.
 */
export async function stubApi(
  page: Page,
  handlers: Record<string, Handler>,
): Promise<SentRequest[]> {
  const sent: SentRequest[] = [];
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const request = route.request();
      const key = `${request.method()} ${new URL(request.url()).pathname.replace(/^\/api/, '')}`;
      const look = PUBLIC_TENANT.exec(key);
      if (handlers[key] === undefined && look !== null) {
        const [, slug = '', stylesheet] = look;
        const name = [northfield, eastmere].find(({ tenant }) => tenant.slug === slug)?.tenant.name;
        await (stylesheet === undefined
          ? route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                name: name ?? slug,
                theme: { brandColour: '#1f4bb8', preset: 'standard', hasLogo: false },
              }),
            })
          : route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
        return;
      }
      const body: unknown = request.postData() === null ? undefined : request.postDataJSON();
      sent.push({ key, body });
      const handler = handlers[key];
      const reply =
        handler === undefined
          ? problem(404, 'No answer was set up for this request.')
          : typeof handler === 'function'
            ? handler(body)
            : handler;
      await route.fulfill({
        status: reply.status,
        contentType: 'application/json',
        headers: reply.headers,
        body: reply.body === undefined ? undefined : JSON.stringify(reply.body),
      });
    },
  );
  return sent;
}

/** A signed-in console: the session, and a sign-out that works. */
export async function stubSignedIn(
  page: Page,
  options: SessionOptions = {},
  more: Record<string, Handler> = {},
): Promise<SentRequest[]> {
  return stubApi(page, {
    'GET /auth/session': { status: 200, body: consoleSession(options) },
    'POST /auth/sign-out': { status: 204 },
    ...more,
  });
}
