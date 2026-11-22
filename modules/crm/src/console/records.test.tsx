// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router, SessionProvider } from '@pixel-scientists/ui';
import type { RouteDefinition, SessionData } from '@pixel-scientists/ui';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { forget } from './search.ts';
import OrganisationPage from './OrganisationPage.tsx';
import PersonPage from './PersonPage.tsx';
import SearchPage from './SearchPage.tsx';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const northfield = {
  id: id(900),
  tenant: { slug: 'northfield', name: 'Northfield Foundation' },
};

function session(overrides: Partial<SessionData> & { modules?: string[] } = {}): SessionData {
  return {
    mfa: 'complete',
    expiresAt: '2099-01-01T00:00:00.000Z',
    user: { email: 'ada@example.org' },
    permissions: ['crm.records.read'],
    activeMembership: northfield,
    memberships: [northfield],
    modules: ['crm'],
    ...overrides,
  };
}

const routes: readonly RouteDefinition[] = [
  { path: '/crm', title: 'Records', component: SearchPage },
  {
    path: '/crm/organisations/:organisationId',
    title: 'Organisation',
    component: OrganisationPage,
  },
  { path: '/crm/people/:personId', title: 'Person', component: PersonPage },
];

type Handler = (body: unknown) => { status: number; body?: unknown };

/** Answers fetch for the keys given and records every request, so nothing unexpected is sent. */
function stubFetch(handlers: Record<string, Handler | { status: number; body?: unknown }>) {
  const sent: { key: string; body: unknown }[] = [];
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
          headers: { 'content-type': 'application/json' },
        }),
      );
    }),
  );
  return sent;
}

function open(path: string, signedIn: SessionData = session()) {
  window.history.replaceState(null, '', path);
  return render(
    <SessionProvider load={() => Promise.resolve(signedIn)} signOut={() => Promise.resolve()}>
      <Router routes={routes} />
    </SessionProvider>,
  );
}

const address = {
  line1: '1 Mill Lane',
  line2: null,
  town: 'Northfield',
  postcode: 'NF1 3QR',
  countryCode: 'GB',
};

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  forget();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('search', () => {
  const page = {
    results: [
      {
        id: id(1),
        kind: 'organisation',
        label: 'Riverside Trust',
        status: 'active',
        verification: 'verified',
      },
      {
        id: id(2),
        kind: 'organisation',
        label: 'Riverside Club',
        status: 'active',
        verification: 'claimed',
      },
      { id: id(3), kind: 'person', label: 'Erased', status: 'erased', verification: 'none' },
    ],
    nextCursor: null,
  };

  it('sends the term in the body, never in the address, and says what each result is in words', async () => {
    const sent = stubFetch({ 'POST /console/crm/search': { status: 200, body: page } });
    const user = userEvent.setup();
    open('/crm');

    await user.type(await screen.findByRole('searchbox'), 'Riverside');
    await user.click(screen.getByRole('button', { name: 'Search records' }));

    const table = await screen.findByRole('table', { name: 'Search results' });
    expect(sent).toEqual([
      { key: 'POST /console/crm/search', body: { term: 'Riverside', limit: 25 } },
    ]);
    expect(window.location.href).not.toContain('Riverside');
    expect(JSON.stringify(window.history.state)).not.toContain('Riverside');
    expect(document.title).not.toContain('Riverside');
    expect(within(table).getByText('Verified')).toBeTruthy();
    expect(within(table).getByText('Unverified')).toBeTruthy();
    expect(within(table).getByRole('link', { name: 'Riverside Trust' }).getAttribute('href')).toBe(
      `/crm/organisations/${id(1)}`,
    );
    expect(within(table).getByText('Erased person')).toBeTruthy();
    expect(within(table).queryByRole('link', { name: /Erased/ })).toBeNull();
    expect(screen.getByText('3 results')).toBeTruthy();
  });

  it('says what to do when nothing matches, and shows the problem when the term is too short', async () => {
    stubFetch({
      'POST /console/crm/search': (body) =>
        (body as { term: string }).term === 'a'
          ? {
              status: 422,
              body: {
                type: 'about:blank',
                title: 'Problem',
                status: 422,
                detail: 'Check the search.',
                requestId: 'req',
                errors: [{ field: 'body.term', message: 'Enter at least 2 characters.' }],
              },
            }
          : { status: 200, body: { results: [], nextCursor: null } },
    });
    const user = userEvent.setup();
    open('/crm');

    await user.type(await screen.findByRole('searchbox'), 'a');
    await user.click(screen.getByRole('button', { name: 'Search records' }));
    expect(await screen.findAllByText('Enter at least 2 characters.')).not.toHaveLength(0);

    await user.type(screen.getByRole('searchbox'), 'b');
    await user.click(screen.getByRole('button', { name: 'Search records' }));
    expect(await screen.findByText('No records match your search')).toBeTruthy();
  });

  it('shows more results with the cursor and keeps what was already shown', async () => {
    const sent = stubFetch({
      'POST /console/crm/search': (body) =>
        (body as { cursor?: string }).cursor === undefined
          ? { status: 200, body: { results: page.results.slice(0, 1), nextCursor: 'abc' } }
          : { status: 200, body: { results: page.results.slice(1, 2), nextCursor: null } },
    });
    const user = userEvent.setup();
    open('/crm');

    await user.type(await screen.findByRole('searchbox'), 'Riverside');
    await user.click(screen.getByRole('button', { name: 'Search records' }));
    await user.click(await screen.findByRole('button', { name: 'Show more results' }));

    await waitFor(() => {
      expect(screen.getByText('2 results')).toBeTruthy();
    });
    expect(sent[1]?.body).toEqual({ term: 'Riverside', limit: 25, cursor: 'abc' });
    expect(screen.getByRole('link', { name: 'Riverside Trust' })).toBeTruthy();
  });

  it('puts the results back when you return from a record', async () => {
    stubFetch({ 'POST /console/crm/search': { status: 200, body: page } });
    const user = userEvent.setup();
    const { unmount } = open('/crm');
    await user.type(await screen.findByRole('searchbox'), 'Riverside');
    await user.click(screen.getByRole('button', { name: 'Search records' }));
    await user.click(await screen.findByRole('link', { name: 'Riverside Trust' }));
    unmount();

    const sent = stubFetch({});
    open('/crm');
    expect(await screen.findByRole('link', { name: 'Riverside Trust' })).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>('searchbox').value).toBe('Riverside');
    expect(sent).toEqual([]);
  });
});

describe('organisation', () => {
  const record = {
    state: 'current',
    status: 'active',
    organisation: {
      id: id(1),
      name: 'Riverside Trust',
      legalForm: 'registered_charity',
      identifiers: [
        { scheme: 'GB-CHC', identifier: '1234567', verified: true },
        { scheme: 'GB-COH', identifier: '01234567', verified: false },
      ],
      registeredAddress: address,
      website: null,
      contacts: [
        { personId: id(2), givenName: 'Sam', familyName: 'Patel', email: 'sam@example.org' },
      ],
    },
    lists: [],
    externalReferences: [],
    timeline: { interactions: 1, latestAt: '2026-11-02T10:00:00.000Z' },
  };
  const timeline = {
    interactions: [
      {
        id: id(10),
        kind: 'application_submitted',
        occurredAt: '2026-11-02T10:00:00.000Z',
        module: 'grants',
        source: { module: 'grants', entityType: 'grants.application', entityId: id(11) },
        summary: null,
        recordedBy: null,
      },
    ],
    nextCursor: null,
  };

  it('shows identifiers in words, contacts as links and a timeline item without a link it may not open', async () => {
    stubFetch({
      [`GET /console/crm/organisations/${id(1)}`]: { status: 200, body: record },
      [`GET /console/crm/parties/${id(1)}/timeline`]: { status: 200, body: timeline },
    });
    open(`/crm/organisations/${id(1)}`);

    expect(await screen.findByRole('heading', { level: 1, name: 'Riverside Trust' })).toBeTruthy();
    const identifiers = screen.getByRole('table', { name: 'Identifiers' });
    expect(within(identifiers).getByText('Verified')).toBeTruthy();
    expect(within(identifiers).getByText('Unverified')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sam Patel' }).getAttribute('href')).toBe(
      `/crm/people/${id(2)}`,
    );
    const timelineTable = await screen.findByRole('table', { name: 'Timeline' });
    expect(within(timelineTable).getByText('Application submitted')).toBeTruthy();
    expect(within(timelineTable).queryByRole('link')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Value history' })).toBeNull();
  });

  it('links a timeline item to the application for a member who may open it', async () => {
    stubFetch({
      [`GET /console/crm/organisations/${id(1)}`]: { status: 200, body: record },
      [`GET /console/crm/parties/${id(1)}/timeline`]: { status: 200, body: timeline },
    });
    open(
      `/crm/organisations/${id(1)}`,
      session({
        permissions: ['crm.records.read', 'grants.applications.read'],
        modules: ['crm', 'grants'],
      }),
    );
    const link = await screen.findByRole('link', { name: 'Open the application' });
    expect(link.getAttribute('href')).toBe(`/submissions/${id(11)}`);
  });

  it('shows value history to a member who can manage records', async () => {
    stubFetch({
      [`GET /console/crm/organisations/${id(1)}`]: { status: 200, body: record },
      [`GET /console/crm/parties/${id(1)}/timeline`]: { status: 200, body: timeline },
      [`GET /console/organisations/${id(1)}/history`]: {
        status: 200,
        body: {
          entries: [
            {
              fieldId: 'organisation.name',
              previousValue: 'Riverside Club',
              newValue: 'Riverside Trust',
              changedAt: '2026-11-01T09:00:00.000Z',
              changedBy: id(5),
            },
          ],
          nextCursor: null,
        },
      },
    });
    open(
      `/crm/organisations/${id(1)}`,
      session({ permissions: ['crm.records.read', 'party.records.manage'] }),
    );
    const history = await screen.findByRole('table', { name: 'Changes to details' });
    expect(within(history).getByText('Riverside Club')).toBeTruthy();
    expect(within(history).getByText('Name')).toBeTruthy();
  });

  it('follows a merged id to the survivor and says so', async () => {
    stubFetch({
      [`GET /console/crm/organisations/${id(9)}`]: {
        status: 200,
        body: { state: 'merged', survivorId: id(1) },
      },
      [`GET /console/crm/organisations/${id(1)}`]: { status: 200, body: record },
      [`GET /console/crm/parties/${id(1)}/timeline`]: { status: 200, body: timeline },
    });
    open(`/crm/organisations/${id(9)}`);
    expect(await screen.findByText('This record was merged')).toBeTruthy();
    expect(window.location.pathname).toBe(`/crm/organisations/${id(1)}`);
  });

  it('shows the not found page for a record the member may not see', async () => {
    stubFetch({
      [`GET /console/crm/organisations/${id(1)}`]: {
        status: 404,
        body: {
          type: 'about:blank',
          title: 'Problem',
          status: 404,
          detail: 'Not found.',
          requestId: 'r',
        },
      },
    });
    open(`/crm/organisations/${id(1)}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy();
  });

  it('shows the not found page, and sends nothing, when crm is off', async () => {
    const sent = stubFetch({});
    open(`/crm/organisations/${id(1)}`, session({ modules: [] }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy();
    expect(sent).toEqual([]);
  });
});

describe('person', () => {
  it('shows an erased person by their status only, with no timeline request', async () => {
    const sent = stubFetch({
      [`GET /console/crm/people/${id(2)}`]: { status: 200, body: { state: 'erased' } },
    });
    open(`/crm/people/${id(2)}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Erased person' })).toBeTruthy();
    expect(sent).toHaveLength(1);
  });

  it('lists the organisations the person is a contact for', async () => {
    stubFetch({
      [`GET /console/crm/people/${id(2)}`]: {
        status: 200,
        body: {
          state: 'current',
          status: 'active',
          person: {
            id: id(2),
            givenName: 'Sam',
            familyName: 'Patel',
            email: 'sam@example.org',
            phone: null,
            organisations: [{ id: id(1), name: 'Riverside Trust' }],
            consents: [],
          },
          lists: [],
          externalReferences: [],
          timeline: { interactions: 0, latestAt: null },
        },
      },
      [`GET /console/crm/parties/${id(2)}/timeline`]: {
        status: 200,
        body: { interactions: [], nextCursor: null },
      },
    });
    open(`/crm/people/${id(2)}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Sam Patel' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Riverside Trust' }).getAttribute('href')).toBe(
      `/crm/organisations/${id(1)}`,
    );
    expect(await screen.findByText(/Nothing has happened with this record yet/)).toBeTruthy();
  });
});
