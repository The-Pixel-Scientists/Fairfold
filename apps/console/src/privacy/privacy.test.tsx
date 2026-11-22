// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The privacy tool's screens as the console opens them: the request list and
// its clock in words, the breach countdown in the funder's time zone, the
// not-found page, and erasure, which waits for the typed name and sends once.

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { consoleSession, problem, stubApi } from '../testing/api.ts';
import { openConsole, setUpConsoleTests } from '../testing/render.tsx';

setUpConsoleTests();

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const person = { id: uid(900), givenName: 'Sam', familyName: 'Taylor' };
const stamps = { createdAt: '2027-01-02T09:00:00.000Z', updatedAt: '2027-01-02T09:00:00.000Z' };

const request = (changes: Record<string, unknown> = {}) => ({
  id: uid(2),
  kind: 'erasure',
  personId: person.id,
  receivedAt: '2026-12-12T09:00:00.000Z',
  receivedOn: '2026-12-12',
  channel: 'email',
  summary: 'Asked to be erased.',
  identityCheck: 'verified',
  clock: { state: 'overdue', dueOn: '2027-01-01' },
  clockEvents: [],
  exportRequestId: null,
  erasureRequestId: null,
  ...stamps,
  ...changes,
});

const listed = (row: ReturnType<typeof request>) => ({
  id: row.id,
  kind: row.kind,
  personId: row.personId,
  receivedOn: row.receivedOn,
  channel: row.channel,
  identityCheck: row.identityCheck,
  clock: row.clock,
});

const everything = [
  'privacy.requests.manage',
  'privacy.requests.export',
  'privacy.requests.erase',
  'privacy.breaches.manage',
];

/** A member of a funder with privacy switched on, holding these permissions. */
const member = (permissions: string[]) => ({
  'GET /auth/session': {
    status: 200,
    body: { ...consoleSession(), modules: ['grants', 'privacy'], permissions },
  },
  'GET /console/settings': {
    status: 200,
    body: { name: 'Northfield Foundation', timeZone: 'Europe/London', fiscalYearStartMonth: 4 },
  },
  'GET /console/team': problem(403, 'You cannot do this.'),
  [`GET /console/people/${person.id}`]: {
    status: 200,
    body: { ...person, email: 'sam@example.org', phone: null, organisations: [], consents: [] },
  },
});

const detail = (changes: Record<string, unknown> = {}) => ({
  [`GET /console/rights-requests/${uid(2)}`]: { status: 200, body: request(changes) },
  [`GET /console/rights-requests/${uid(2)}/tasks`]: { status: 200, body: { tasks: [] } },
});

describe('the privacy screens', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2027-01-04T10:00:00.000Z') });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lands on the request list, with the clock in words', async () => {
    stubApi({
      ...member(everything),
      'GET /console/rights-requests': {
        status: 200,
        body: {
          requests: [
            listed(request()),
            listed(request({ id: uid(3), clock: { state: 'running', dueOn: '2027-01-12' } })),
            listed(request({ id: uid(4), clock: { state: 'paused', dueOn: null } })),
          ],
          nextCursor: null,
        },
      },
    });
    openConsole('/northfield/privacy');

    expect(await screen.findByText('Overdue by 3 days')).toBeTruthy();
    expect(screen.getByText('Due 12 January 2027 (8 days left)')).toBeTruthy();
    expect(screen.getByText(/the due date is not known until it restarts/)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Data protection requests');
  });

  it('says how long ago an open breach passed its ICO deadline', async () => {
    stubApi({
      ...member(everything),
      'GET /console/breaches': {
        status: 200,
        body: {
          breaches: [
            {
              id: uid(300),
              becameAwareAt: '2026-12-06T15:15:00.000Z',
              dataCategories: ['contact'],
              specialCategory: false,
              clock: { deadline: '2026-12-09T15:15:00.000Z', hoursRemaining: 0, late: true },
              riskLevel: null,
              icoNotified: false,
            },
          ],
          nextCursor: null,
        },
      },
    });
    openConsole('/northfield/privacy?view=breaches');

    expect(await screen.findByText('ICO deadline passed 25 days ago')).toBeTruthy();
  });

  it('shows the not-found page for a screen the member may not use', async () => {
    stubApi(member(['privacy.requests.manage']));
    openConsole('/northfield/privacy?view=dpias');

    await screen.findByRole('heading', { level: 1, name: 'Page not found' });
  });

  it('shows the not-found page for an id that is not one', async () => {
    stubApi(member(everything));
    openConsole('/northfield/privacy?view=request&id=not-an-id');

    await screen.findByRole('heading', { level: 1, name: 'Page not found' });
  });

  it('offers no erasure without the erasure permission', async () => {
    vi.useRealTimers();
    stubApi({ ...member(['privacy.requests.manage']), ...detail() });
    openConsole(`/northfield/privacy?view=request&id=${uid(2)}`);

    await screen.findByRole('heading', { level: 1, name: 'Erasure request' });
    expect(screen.queryByRole('button', { name: /Erase/ })).toBeNull();
  });

  it('erases only after the name is typed, sending confirm alone, once however often it is pressed', async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    const sent = stubApi({
      ...member(everything),
      ...detail(),
      [`POST /console/rights-requests/${uid(2)}/erasure`]: {
        status: 202,
        body: { requestId: uid(701) },
      },
    });
    openConsole(`/northfield/privacy?view=request&id=${uid(2)}`);

    await screen.findByText('Sam Taylor');
    await user.click(screen.getByRole('button', { name: "Erase this person's data" }));
    await screen.findByRole('dialog', { name: "Erase this person's data" });
    const erase = screen.getByRole('button', { name: "Erase Sam Taylor's data" });
    const field = screen.getByLabelText(/Type Sam Taylor to confirm/);

    await user.type(field, 'Sam');
    await user.click(erase);
    expect(
      await screen.findAllByText('Type Sam Taylor exactly as shown to confirm.'),
    ).not.toHaveLength(0);
    expect(sent.some(({ key }) => key.startsWith('POST'))).toBe(false);

    await user.clear(field);
    await user.type(field, 'Sam Taylor');
    await user.dblClick(erase);

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: "Erase this person's data" })).toBeNull();
    });
    const posts = sent.filter(({ key }) => key.startsWith('POST'));
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toEqual({ confirm: true });
  });
});
