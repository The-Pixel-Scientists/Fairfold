// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Test helpers: the funder's session, the console's routes and a stand-in
// for the API that records every request, so nothing unexpected is sent.

import { Router, SessionProvider } from '@pixel-scientists/ui';
import type { SessionData } from '@pixel-scientists/ui';
import { configure, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { assureConsoleRoutes } from './index.ts';

/** Each page loads its code when first opened, which a busy machine can slow past a second. */
configure({ asyncUtilTimeout: 5000 });

export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const northfield = { id: id(900), tenant: { slug: 'northfield', name: 'Northfield Foundation' } };

export const everything = [
  'assure.duplicates.review',
  'assure.checklists.manage',
  'assure.checklists.complete',
  'assure.visits.manage',
];

export function session(permissions = everything, modules = ['assure']): SessionData {
  return {
    mfa: 'complete',
    expiresAt: '2099-01-01T00:00:00.000Z',
    user: { email: 'ada@example.org' },
    permissions,
    activeMembership: northfield,
    memberships: [northfield],
    modules,
  } as SessionData;
}

export type Handler = (body: unknown) => { status: number; body?: unknown };

export const problem = (status: number, detail: string, errors: unknown[] = []) => ({
  status,
  body: { type: 'about:blank', title: 'Problem', status, detail, errors, requestId: 'req_test' },
});

export interface Sent {
  key: string;
  body: unknown;
}

/** Answers fetch for the keys given and records every request. */
export function stubFetch(handlers: Record<string, Handler | { status: number; body?: unknown }>) {
  const sent: Sent[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      const key = `${init.method ?? 'GET'} ${url.replace(/^\/api/, '').split('?')[0] ?? ''}`;
      const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      sent.push({ key, body });
      const handler = handlers[key];
      if (handler === undefined) return Promise.reject(new Error(`Unexpected request: ${key}`));
      const reply = typeof handler === 'function' ? handler(body) : handler;
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

export function open(path: string, signedIn: SessionData = session()): void {
  window.history.replaceState(null, '', path);
  render(
    <SessionProvider load={() => Promise.resolve(signedIn)} signOut={() => Promise.resolve()}>
      <Router routes={assureConsoleRoutes} />
    </SessionProvider>,
  );
}

describe('harness', () => {
  it('numbers ids the way the contracts expect', () => {
    expect(id(7)).toBe('00000000-0000-4000-8000-000000000007');
  });
});
