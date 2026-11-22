// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Test helpers: open the forms screens at an address, with a stand-in for the
// API that answers `fetch`, so the real contracts check every request and
// reply. Not part of the screens.

import { Router, SessionProvider } from '@pixel-scientists/ui';
import type { SessionData } from '@pixel-scientists/ui';
import { configure, render } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formsRoutes } from './index.ts';
import { forgetPages } from './pages.ts';

/** A valid id for fixtures: the same number gives the same id. */
export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const permissions = [
  'forms.forms.manage',
  'forms.forms.publish',
  'forms.retention.manage',
  'forms.responses.read',
  'forms.responses.manage',
];

export interface Reply {
  status: number;
  body?: unknown;
}

export const ok = (body: unknown): Reply => ({ status: 200, body });

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

export interface Sent {
  /** `POST /console/forms`, without the `/api` prefix, with any query. */
  key: string;
  body: unknown;
  idempotencyKey: string | null;
}

type Handler = Reply | ((body: unknown, sent: readonly Sent[]) => Reply);

/**
 * Answers `fetch` for the keys given, where a key ending in `*` matches any
 * request that starts with it, and fails on any other request, so nothing is
 * sent that a test did not expect. Returns what was sent.
 */
export function stubApi(handlers: Record<string, Handler>): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      const key = `${init.method ?? 'GET'} ${url.replace(/^\/api/, '')}`;
      const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      const headers = new Headers(init.headers);
      sent.push({ key, body, idempotencyKey: headers.get('idempotency-key') });
      const handler =
        handlers[key] ??
        Object.entries(handlers).find(
          ([pattern]) => pattern.endsWith('*') && key.startsWith(pattern.slice(0, -1)),
        )?.[1];
      if (handler === undefined) return Promise.reject(new Error(`Unexpected request: ${key}`));
      const reply = typeof handler === 'function' ? handler(body, sent) : handler;
      return Promise.resolve(
        new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
          status: reply.status,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }),
  );
  return sent;
}

function session(held: readonly string[]): SessionData {
  const membership = { id: id(900), tenant: { slug: 'northfield', name: 'Northfield Foundation' } };
  return {
    mfa: 'complete',
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    user: { email: 'ada@example.org' },
    permissions: held,
    activeMembership: membership,
    memberships: [membership],
  };
}

/** Call once at the top of a test file: puts the page back between tests. */
export function setUpFormsTests(): void {
  configure({ asyncUtilTimeout: 5000 });
  beforeEach(() => {
    forgetPages();
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  });
  afterEach(() => {
    forgetPages();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.history.replaceState(null, '', '/');
    document.title = '';
  });
}

const signOut = () => Promise.resolve();

export function openForms(path: string, held: readonly string[] = permissions): RenderResult {
  window.history.replaceState(null, '', path);
  const load = () => Promise.resolve(session(held));
  return render(
    <SessionProvider load={load} signOut={signOut}>
      <Router routes={formsRoutes} />
    </SessionProvider>,
  );
}

describe('the API stand-in', () => {
  it('answers the keys it is given, by prefix for a key ending in a star, and fails on any other', async () => {
    const sent = stubApi({
      'GET /console/forms': ok({}),
      'GET /console/forms?*': ok({ any: true }),
    });

    expect((await fetch('/api/console/forms', { method: 'GET' })).status).toBe(200);
    expect(
      await (await fetch('/api/console/forms?status=draft', { method: 'GET' })).json(),
    ).toEqual({
      any: true,
    });
    await expect(fetch('/api/console/other', { method: 'GET' })).rejects.toThrow(
      'Unexpected request: GET /console/other',
    );
    expect(sent).toHaveLength(3);
    vi.unstubAllGlobals();
  });
});
