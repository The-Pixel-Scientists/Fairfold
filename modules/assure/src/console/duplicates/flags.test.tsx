// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { id, open, session, stubFetch } from '../harness.test.tsx';

const APPLICATION = id(3);
const FLAGS = `GET /console/applications/${APPLICATION}/duplicate-flags`;
const CHECKLISTS = `GET /console/applications/${APPLICATION}/checklists`;

const flag = (n: number, signal: string) => ({
  id: id(n),
  partyId: id(1),
  otherPartyId: id(n + 100),
  applicationId: APPLICATION,
  otherApplicationId: null,
  signal,
  raisedAt: '2026-12-01T10:00:00.000Z',
  dismissal: null,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('duplicate flags panel', () => {
  it('says flags are advisory and names each signal in words, with no merge or block', async () => {
    stubFetch({
      [FLAGS]: {
        status: 200,
        body: { flags: [flag(10, 'similar_name'), flag(11, 'shared_contact_point')] },
      },
      [CHECKLISTS]: { status: 200, body: { checklists: [] } },
    });
    open(`/assure/applications/${APPLICATION}`);

    expect(await screen.findByText('Has a similar name to another record')).toBeTruthy();
    expect(screen.getByText('Shares a contact email or phone with another record')).toBeTruthy();
    expect(screen.getByText(/Nothing has been blocked or held/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /merge|verify|link|dismiss/i })).toBeNull();
  });

  it('shows an empty state in words when nothing is flagged', async () => {
    stubFetch({
      [FLAGS]: { status: 200, body: { flags: [] } },
      [CHECKLISTS]: { status: 200, body: { checklists: [] } },
    });
    open(`/assure/applications/${APPLICATION}`);
    expect(
      await screen.findByText('No possible duplicates found for this application.'),
    ).toBeTruthy();
  });

  it('asks for neither flags nor checklists without the permissions, and shows not found with assure off', async () => {
    const sent = stubFetch({});
    open(`/assure/applications/${APPLICATION}`, session(['assure.visits.manage']));
    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy();
    expect(screen.queryByText('Possible duplicates')).toBeNull();
    expect(sent).toEqual([]);
  });

  it('makes no request while assure is off', async () => {
    const sent = stubFetch({});
    open(`/assure/applications/${APPLICATION}`, session(undefined, []));
    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy();
    expect(sent).toEqual([]);
  });
});
