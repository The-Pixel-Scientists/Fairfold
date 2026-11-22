// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router, SessionProvider } from '@pixel-scientists/ui';
import type { RouteDefinition, SessionData } from '@pixel-scientists/ui';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import MatchesPage from './MatchesPage.tsx';
import MatchPage from './MatchPage.tsx';
import OrganisationLookupsPage from './OrganisationLookupsPage.tsx';
import { POLL_INTERVAL_MS } from './RegistryPanel.tsx';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const northfield = { id: id(900), tenant: { slug: 'northfield', name: 'Northfield Foundation' } };
const ORGANISATION = id(1);
const MATCH = id(2);
const STEP_UP_NEEDED = 'Confirm it is you again, then try again.';

const allowed = [
  'assure.lookup.read',
  'assure.lookup.run',
  'assure.screening.read',
  'assure.screening.decide',
];

function session(permissions = allowed, modules = ['assure']): SessionData {
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

const routes: readonly RouteDefinition[] = [
  { path: '/assure/matches', title: 'Possible matches', component: MatchesPage },
  { path: '/assure/matches/:matchId', title: 'Possible match', component: MatchPage },
  {
    path: '/assure/organisations/:organisationId',
    title: 'Registry details',
    component: OrganisationLookupsPage,
  },
];

type Handler = (body: unknown) => { status: number; body?: unknown };

function problem(status: number, detail: string) {
  return {
    status,
    body: { type: 'about:blank', title: 'Problem', status, detail, requestId: 'req_test' },
  };
}

/** Answers fetch for the keys given and records every request, so nothing unexpected is sent. */
function stubFetch(handlers: Record<string, Handler | { status: number; body?: unknown }>) {
  const sent: { key: string; body: unknown }[] = [];
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

function open(path: string, signedIn: SessionData = session()) {
  window.history.replaceState(null, '', path);
  return render(
    <SessionProvider load={() => Promise.resolve(signedIn)} signOut={() => Promise.resolve()}>
      <Router routes={routes} />
    </SessionProvider>,
  );
}

const LOOKUPS = `GET /console/organisations/${ORGANISATION}/lookups`;
const REFRESH = `POST /console/organisations/${ORGANISATION}/lookups`;

function snapshot(fetchedAt: string) {
  return {
    id: id(10),
    registry: 'charity_commission',
    identifier: '1000001',
    fetchedAt,
    outcome: 'found',
    details: {
      status: 'registered',
      registeredName: 'Riverside Lunch Club',
      registeredAddress: null,
      registeredOn: '2001-04-05',
      removedOn: null,
      accounts: null,
      accountsOverdue: null,
      officerCount: 0,
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('registry panel', () => {
  it('shows the source, the fetched time and the register fields, with no officer names', async () => {
    stubFetch({
      [LOOKUPS]: {
        status: 200,
        body: { snapshots: [snapshot(new Date().toISOString())], notSetUp: ['oscr'] },
      },
    });
    open(`/assure/organisations/${ORGANISATION}`);

    expect(await screen.findByText(/From the Charity Commission register\. Fetched/)).toBeTruthy();
    expect(screen.getByText('Riverside Lunch Club')).toBeTruthy();
    expect(screen.queryByText('Out of date')).toBeNull();
    expect(screen.getByText(/not set up for your funder/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /officers/ })).toBeNull();
  });

  it('keeps the officers button, names it by register, and announces the list and a failure', async () => {
    const user = userEvent.setup();
    let fail = true;
    stubFetch({
      [LOOKUPS]: {
        status: 200,
        body: {
          snapshots: [
            {
              ...snapshot(new Date().toISOString()),
              details: { ...snapshot('x').details, officerCount: 2 },
            },
          ],
          notSetUp: [],
        },
      },
      [`GET /console/lookups/${id(10)}/officers`]: () =>
        fail
          ? problem(503, 'The register is not available. Try again later.')
          : {
              status: 200,
              body: {
                officers: [
                  { id: id(40), name: 'Ada Example', role: 'trustee', personId: null },
                  { id: id(41), name: 'Sam Sample', role: 'trustee', personId: null },
                ],
              },
            },
    });
    open(`/assure/organisations/${ORGANISATION}`);

    const button = await screen.findByRole('button', {
      name: 'Show 2 officers and trustees from Charity Commission',
    });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    await user.click(button);
    expect((await screen.findByRole('alert')).textContent).toContain('not available');

    fail = false;
    await user.click(button);
    const list = await screen.findByRole('list', {
      name: 'Officers and trustees from Charity Commission',
    });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(button.isConnected).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Ada Example')).toBeTruthy();
  });

  it('says in words that a lookup is out of date', async () => {
    stubFetch({
      [LOOKUPS]: {
        status: 200,
        body: { snapshots: [snapshot('2020-01-01T10:00:00.000Z')], notSetUp: [] },
      },
    });
    open(`/assure/organisations/${ORGANISATION}`);

    expect(await screen.findByText('Out of date')).toBeTruthy();
    expect(screen.getByText(/more than 30 days old/)).toBeTruthy();
  });

  it('sends one refresh for a double click, then re-reads until the fetched time changes', async () => {
    const reads = [snapshot('2020-01-01T10:00:00.000Z'), snapshot('2026-12-03T14:05:00.000Z')];
    let read = 0;
    const sent = stubFetch({
      [LOOKUPS]: () => ({
        status: 200,
        body: { snapshots: [reads[Math.min(read++, 1)]], notSetUp: [] },
      }),
      [REFRESH]: {
        status: 202,
        body: {
          jobId: id(20),
          registry: 'charity_commission',
          queuedAt: '2026-12-03T14:04:00.000Z',
        },
      },
    });
    open(`/assure/organisations/${ORGANISATION}`);
    const button = await screen.findByRole('button', {
      name: 'Refresh registry details from Charity Commission',
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    await user.dblClick(button);

    expect(await screen.findByText(/Refresh started for Charity Commission/)).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS));

    expect(await screen.findByText('Charity Commission details are up to date.')).toBeTruthy();
    expect(sent.filter(({ key }) => key === REFRESH)).toHaveLength(1);
    expect(sent.find(({ key }) => key === REFRESH)?.body).toEqual({
      registry: 'charity_commission',
    });
  });

  it('shows the words a failed refresh comes with', async () => {
    const user = userEvent.setup();
    stubFetch({
      [LOOKUPS]: {
        status: 200,
        body: { snapshots: [snapshot('2020-01-01T10:00:00.000Z')], notSetUp: [] },
      },
      [REFRESH]: problem(429, 'The register is busy. Try again in a few minutes.'),
    });
    open(`/assure/organisations/${ORGANISATION}`);

    await user.click(
      await screen.findByRole('button', {
        name: 'Refresh registry details from Charity Commission',
      }),
    );

    expect(
      await screen.findByText('The register is busy. Try again in a few minutes.'),
    ).toBeTruthy();
  });

  it('offers no refresh without the permission', async () => {
    stubFetch({
      [LOOKUPS]: {
        status: 200,
        body: { snapshots: [snapshot('2020-01-01T10:00:00.000Z')], notSetUp: [] },
      },
    });
    open(`/assure/organisations/${ORGANISATION}`, session(['assure.lookup.read']));

    await screen.findByText(/From the Charity Commission register/);
    expect(
      screen.queryByRole('button', { name: 'Refresh registry details from Charity Commission' }),
    ).toBeNull();
  });

  it('shows the not-found page, and asks for nothing, when assure is off', async () => {
    const sent = stubFetch({});
    open(`/assure/organisations/${ORGANISATION}`, session(allowed, ['grants']));

    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy();
    expect(sent).toEqual([]);
  });
});

const summary = {
  id: MATCH,
  runId: id(30),
  partyId: id(31),
  subjectPartyId: null,
  nameSource: 'registered_name',
  entryKind: 'entity',
  similarity: 0.87,
  status: 'open',
  raisedAt: '2026-12-01T10:00:00.000Z',
};

const detail = {
  ...summary,
  screenedName: 'Riverside Lunch Club',
  officerId: null,
  entry: {
    designationId: 'TEST0001',
    name: 'Riverbank Lunch Society',
    regime: 'Test regime',
    designatedOn: '2020-02-03',
    datesOfBirth: [],
    nationalities: [],
    country: 'Testland',
  },
  list: { id: id(32), publishedOn: '2026-11-30', downloadedAt: '2026-12-01T06:00:00.000Z' },
  decisions: [],
};

const LIST = 'GET /console/screening-matches';
const READ = `GET /console/screening-matches/${MATCH}`;
const DECIDE = `POST /console/screening-matches/${MATCH}/decisions`;

describe('matches queue', () => {
  it('lists open matches with the advisory score and opens one', async () => {
    stubFetch({ [LIST]: { status: 200, body: { matches: [summary], nextCursor: null } } });
    open('/assure/matches');

    const table = await screen.findByRole('table');
    expect(within(table).getByText('87%')).toBeTruthy();
    expect(within(table).getByText('Registered name')).toBeTruthy();
    expect(within(table).getByRole('link', { name: '1 December 2026' })).toBeTruthy();
  });

  it('announces a failed or finished load of more matches', async () => {
    const user = userEvent.setup();
    let fail = true;
    let reads = 0;
    stubFetch({
      [LIST]: () =>
        reads++ === 0
          ? { status: 200, body: { matches: [summary], nextCursor: 'next' } }
          : fail
            ? problem(503, 'The queue is not available. Try again later.')
            : { status: 200, body: { matches: [{ ...summary, id: id(3) }], nextCursor: null } },
    });
    open('/assure/matches');

    const more = await screen.findByRole('button', { name: 'Show more matches' });
    await user.click(more);
    expect((await screen.findByRole('alert')).textContent).toContain('not available');

    fail = false;
    await user.click(more);
    expect(await screen.findByText('Showing 2 matches.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says what to do when there is nothing to review', async () => {
    stubFetch({ [LIST]: { status: 200, body: { matches: [], nextCursor: null } } });
    open('/assure/matches');

    expect(await screen.findByText('No matches to review')).toBeTruthy();
  });

  it('shows the not-found page without the permission', async () => {
    const sent = stubFetch({});
    open('/assure/matches', session(['assure.lookup.read']));

    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy();
    expect(sent).toEqual([]);
  });
});

describe('match and decision', () => {
  it('shows both names side by side with the advisory words, and no decision button without the permission', async () => {
    stubFetch({ [READ]: { status: 200, body: detail } });
    open(`/assure/matches/${MATCH}`, session(['assure.screening.read']));

    expect(
      await screen.findByText(/It is advisory\. Nothing has been blocked or rejected/),
    ).toBeTruthy();
    expect(screen.getByText('Riverbank Lunch Society')).toBeTruthy();
    expect(screen.getAllByText('Riverside Lunch Club').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Record decision' })).toBeNull();
  });

  it('asks to confirm sign-in, then records only the outcome and the reason', async () => {
    const user = userEvent.setup();
    let tries = 0;
    const sent = stubFetch({
      [READ]: { status: 200, body: detail },
      [DECIDE]: () => {
        tries += 1;
        return tries === 1
          ? problem(403, STEP_UP_NEEDED)
          : {
              status: 201,
              body: {
                id: id(40),
                outcome: 'not_a_match',
                reason: 'different_name',
                decidedAt: '2026-12-03T14:05:00.000Z',
                decidedBy: northfield.id,
              },
            };
      },
      'POST /auth/step-up': {
        status: 200,
        body: {
          user: { id: id(901), email: 'ada@example.org' },
          expiresAt: '2099-01-01T00:00:00.000Z',
          app: 'console',
          mfa: 'complete',
          recentAuthUntil: '2099-01-01T00:00:00.000Z',
          activeMembership: { ...northfield, roles: ['programme_manager'] },
          memberships: [{ ...northfield, roles: ['programme_manager'] }],
          permissions: allowed,
          modules: ['assure'],
        },
      },
    });
    open(`/assure/matches/${MATCH}`);

    await user.click(await screen.findByRole('button', { name: 'Record decision' }));
    const dialog = await screen.findByRole('dialog', { name: 'Record decision' });
    expect(within(dialog).getByText(/does not reject, block or pay anything/)).toBeTruthy();
    await user.click(within(dialog).getByRole('radio', { name: 'Not a match' }));
    await user.selectOptions(within(dialog).getByLabelText('Reason'), 'different_name');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm decision' }));

    const confirm = await screen.findByRole('dialog', { name: 'Confirm it is you' });
    await user.type(within(confirm).getByLabelText('Password'), 'correct horse battery');
    await user.type(within(confirm).getByLabelText(/Code from your authenticator app/), '123456');
    await user.click(within(confirm).getByRole('button', { name: 'Confirm it is you' }));

    const heading = await screen.findByRole('heading', { name: 'Decision recorded: Not a match' });
    await waitFor(() => {
      expect(document.activeElement).toBe(heading);
    });
    const posts = sent.filter(({ key }) => key === DECIDE);
    expect(posts).toHaveLength(2);
    expect(posts[1]?.body).toEqual({ outcome: 'not_a_match', reason: 'different_name' });
  });

  it('says how to fix a missing choice', async () => {
    const user = userEvent.setup();
    const sent = stubFetch({ [READ]: { status: 200, body: detail } });
    open(`/assure/matches/${MATCH}`);

    await user.click(await screen.findByRole('button', { name: 'Record decision' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm decision' }));

    expect(
      (
        await screen.findAllByText(
          'Choose whether this is not a match, needs more information, or is confirmed.',
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(sent.filter(({ key }) => key === DECIDE)).toHaveLength(0);
  });
});
