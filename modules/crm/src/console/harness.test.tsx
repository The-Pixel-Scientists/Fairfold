// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Test helpers: the funder's session, the console's routes and a stand-in
// for the API that records every request, so nothing unexpected is sent.

import { Router, SessionProvider } from '@pixel-scientists/ui';
import type { RouteDefinition, SessionData } from '@pixel-scientists/ui';
import { configure, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { crmConsoleRoutes } from './index.ts';

/** Each page loads its code when first opened, which a busy machine can slow past a second. */
configure({ asyncUtilTimeout: 5000 });

export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const northfield = {
  id: id(900),
  tenant: { slug: 'northfield', name: 'Northfield Foundation' },
};

export function session(
  permissions: string[],
  overrides: Partial<SessionData> & { modules?: string[] } = {},
): SessionData {
  return {
    mfa: 'complete',
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    user: { email: 'ada@example.org' },
    permissions: ['crm.records.read', ...permissions],
    activeMembership: northfield,
    memberships: [northfield],
    modules: ['crm'],
    ...overrides,
  };
}

const routes: readonly RouteDefinition[] = crmConsoleRoutes;

export type Handler = (body: unknown) => { status: number; body?: unknown };
export interface Sent {
  key: string;
  body: unknown;
  headers: Record<string, string>;
}

/** Answers fetch for the keys given and records every request. */
export function stubFetch(handlers: Record<string, Handler | { status: number; body?: unknown }>) {
  const sent: Sent[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      const key = `${init.method ?? 'GET'} ${url.replace(/^\/api/, '')}`;
      const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      sent.push({ key, body, headers: init.headers as Record<string, string> });
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

export function open(path: string, signedIn: SessionData): void {
  window.history.replaceState(null, '', path);
  render(
    <SessionProvider load={() => Promise.resolve(signedIn)} signOut={() => Promise.resolve()}>
      <Router routes={routes} />
    </SessionProvider>,
  );
}

export const organisationRecord = (name: string) => ({
  state: 'current',
  status: 'active',
  organisation: {
    id: id(1),
    name,
    legalForm: 'registered_charity',
    identifiers: [],
    registeredAddress: {
      line1: '1 Mill Lane',
      line2: null,
      town: 'Northfield',
      postcode: 'NF1 3QR',
      countryCode: 'GB',
    },
    website: null,
    contacts: [],
  },
  lists: [],
  externalReferences: [],
  timeline: { interactions: 0, latestAt: null },
});

/** The API's problem answer. */
export const problem = (status: number, detail: string) => ({
  status,
  body: { type: 'about:blank', title: 'Problem', status, detail, requestId: 'req_test' },
});

export const STEP_UP_NEEDED = 'Confirm it is you again, then try again.';

/** What step-up answers: the same session, now with a recent sign-in. */
export const refreshedSession = (permissions: string[]) => ({
  user: { id: id(800), email: 'ada@example.org' },
  expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
  app: 'console',
  mfa: 'complete',
  recentAuthUntil: new Date(Date.now() + 300_000).toISOString(),
  activeMembership: {
    id: id(900),
    tenant: { slug: 'northfield', name: 'Northfield Foundation' },
    roles: ['programme_manager'],
  },
  memberships: [
    {
      id: id(900),
      tenant: { slug: 'northfield', name: 'Northfield Foundation' },
      roles: ['programme_manager'],
    },
  ],
  permissions: ['crm.records.read', ...permissions],
  modules: ['crm'],
});

describe('the test harness', () => {
  it('refuses a request nobody expected, so a page cannot send one unseen', async () => {
    const sent = stubFetch({});
    await expect(fetch('/api/console/crm/search', { method: 'POST' })).rejects.toThrow(
      'Unexpected request: POST /console/crm/search',
    );
    expect(sent).toHaveLength(1);
    vi.unstubAllGlobals();
  });
});
