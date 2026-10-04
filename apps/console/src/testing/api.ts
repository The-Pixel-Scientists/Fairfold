// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Test helpers: sessions built from the contracts, and a stand-in for the
// API that answers `fetch` with canned replies. Not part of the app.

import { sessionSchema } from '@pixel-scientists/domain/auth';
import type { Session } from '@pixel-scientists/domain/auth';
import { permissionsFor } from '@pixel-scientists/domain/platform';
import type { Role } from '@pixel-scientists/domain/platform';
import { vi } from 'vitest';

export const northfield = {
  id: '0b8f7c1e-7a3d-4c55-9a52-2f6f1a9d4e10',
  tenant: { slug: 'northfield', name: 'Northfield Foundation' },
} as const;

export const eastmere = {
  id: '5d1c2b9a-3e4f-4a6b-8c7d-9e0f1a2b3c4d',
  tenant: { slug: 'eastmere', name: 'Eastmere Trust' },
} as const;

interface SessionOptions {
  /** The funder the session is working for. Null is a signed-in person with no membership in the address. */
  active?: typeof northfield | typeof eastmere | null;
  memberships?: readonly (typeof northfield | typeof eastmere)[];
  roles?: readonly Role[];
  mfa?: 'enrol' | 'verify' | 'complete';
  /** Minutes until the session ends. */
  minutes?: number;
}

/** A console session, checked against the contract so a fixture cannot drift from it. */
export function consoleSession(options: SessionOptions = {}): Session {
  const {
    active = northfield,
    memberships = [northfield],
    roles = ['programme_manager'],
  } = options;
  const { mfa = 'complete', minutes = 30 } = options;
  const expiresAt = new Date(Date.now() + minutes * 60_000).toISOString();
  const user = { id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d', email: 'ada@example.org' };
  if (mfa !== 'complete') {
    return sessionSchema.parse({
      user,
      expiresAt,
      app: 'console',
      mfa,
      recentAuthUntil: null,
      activeMembership: null,
      memberships: [],
      permissions: [],
    });
  }
  const withRoles = (membership: typeof northfield | typeof eastmere) => ({
    ...membership,
    roles,
  });
  return sessionSchema.parse({
    user,
    expiresAt,
    app: 'console',
    mfa,
    recentAuthUntil: null,
    activeMembership: active === null ? null : withRoles(active),
    memberships: memberships.map(withRoles),
    permissions: active === null ? [] : permissionsFor(roles, 'console'),
  });
}

/** What the code under test sent. */
export interface SentRequest {
  /** `POST /auth/sign-out`, without the `/api` prefix. */
  key: string;
  body: unknown;
}

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/** The API's problem answer (RFC 9457), as the contracts describe it. */
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
      requestId: 'req_test',
      ...(errors ? { errors } : {}),
    },
  };
}

export const signedOut = problem(401, 'You are not signed in.');

type Handler = Reply | ((body: unknown) => Reply);

/**
 * Answers `fetch` for the keys given, such as `GET /auth/session`, and fails
 * the test on any other request, so nothing is sent that a test did not
 * expect. Returns what was sent.
 */
export function stubApi(handlers: Record<string, Handler>): SentRequest[] {
  const sent: SentRequest[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      const key = `${init.method ?? 'GET'} ${url.replace(/^\/api/, '')}`;
      const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      sent.push({ key, body });
      const handler = handlers[key];
      if (handler === undefined) return Promise.reject(new Error(`Unexpected request: ${key}`));
      const reply = typeof handler === 'function' ? handler(body) : handler;
      return Promise.resolve(
        new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
          status: reply.status,
          headers: { 'content-type': 'application/json', ...reply.headers },
        }),
      );
    }),
  );
  return sent;
}
