// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Browsing a funder's open rounds before signing in.

import { publicRoundListSchema, publicRoundSchema } from '@pixel-scientists/grants/contracts';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { problem, signedOut, stubApi } from '../testing/api.ts';
import { ok, signedIn } from '../testing/party.ts';
import { openPortal, setUpPortalTests } from '../testing/render.tsx';

setUpPortalTests();

const ROUND_ID = '8a1f3c5e-2b4d-4e6a-9c7b-0d1e2f3a4b5c';
const OTHER_ID = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';

const round = publicRoundSchema.parse({
  id: ROUND_ID,
  title: 'Round 1',
  programme: { title: 'Programme A', summary: 'Grants for community groups.' },
  opensAt: '2027-01-04T09:00:00Z',
  closesAt: '2027-01-14T17:00:00Z',
  timeZone: 'Europe/London',
  awardMinimum: { amountMinor: 500_000, currency: 'GBP' },
  awardMaximum: { amountMinor: 2_500_000, currency: 'GBP' },
  eligibility: [
    {
      label: 'Is your organisation a registered charity?',
      explanation: 'This programme is open to registered charities only.',
    },
  ],
});

const list = (...rounds: (typeof round)[]) => ok(publicRoundListSchema.parse({ rounds }));
const LIST = 'GET /public/tenants/northfield/rounds';
const ONE = `GET /public/tenants/northfield/rounds/${ROUND_ID}`;
const heading = (name: string, level = 1) => screen.findByRole('heading', { level, name });

/** What the portal sent to a public address. */
function sentTo(url: string): RequestInit | undefined {
  const calls = vi.mocked(fetch).mock.calls as unknown as [string, RequestInit][];
  return calls.find(([sent]) => sent === `/api${url}`)?.[1];
}

describe('open grants', () => {
  it('lists each round in the order sent, with no credentials', async () => {
    stubApi({
      'GET /auth/session': signedOut,
      [LIST]: list({ ...round, id: OTHER_ID, title: 'Round 2' }, round),
    });
    openPortal('/northfield/open-grants');

    expect(await heading('Open grants')).toBeTruthy();
    const cards = (await screen.findAllByRole('heading', { level: 2 })).map((h) => h.closest('li'));
    expect(cards).toHaveLength(2);
    const card = cards[1];
    if (card === null || card === undefined) throw new Error('Not in a list.');
    expect(within(card).getByText('Round 1')).toBeTruthy();
    expect(within(card).getByText('5pm on 14 January 2027 (UK time)')).toBeTruthy();
    expect(within(card).getByText('£5,000 to £25,000')).toBeTruthy();
    expect(within(card).getByRole('link', { name: 'Read more about Programme A' })).toHaveProperty(
      'pathname',
      `/northfield/open-grants/${ROUND_ID}`,
    );
    expect(sentTo('/public/tenants/northfield/rounds')?.credentials).toBe('omit');
  });

  it('shows a calm empty state with a way back', async () => {
    stubApi({ 'GET /auth/session': signedOut, [LIST]: list() });
    openPortal('/northfield/open-grants');

    expect(await heading('There are no open grants at the moment', 2)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to the start page' })).toHaveProperty(
      'pathname',
      '/northfield/',
    );
  });

  it('shows the not found page for a 404, without echoing the address', async () => {
    stubApi({ 'GET /auth/session': signedOut, [LIST]: problem(404, 'Not found.') });
    openPortal('/northfield/open-grants');

    expect(await heading('Page not found')).toBeTruthy();
    expect(document.body.textContent).not.toContain('northfield');
  });

  it('says how long to wait after a 429, and tries again', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    stubApi({
      'GET /auth/session': signedOut,
      [LIST]: () => {
        attempts += 1;
        return attempts === 1
          ? { ...problem(429, 'Slow down.'), headers: { 'retry-after': '45' } }
          : list(round);
      },
    });
    openPortal('/northfield/open-grants');

    expect(
      await screen.findByText('Too many attempts. Wait 45 seconds, then try again.'),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await heading('Programme A', 2)).toBeTruthy();
  });

  it('offers to try again after any other failure, without the server text', async () => {
    stubApi({ 'GET /auth/session': signedOut, [LIST]: problem(503, 'Database on fire.') });
    openPortal('/northfield/open-grants');

    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByText(/on fire/)).toBeNull();
  });
});

describe('one open grant', () => {
  it('shows the dates, the award range and who can apply, then the sign-in actions', async () => {
    stubApi({ 'GET /auth/session': signedOut, [ONE]: ok(round) });
    openPortal(`/northfield/open-grants/${ROUND_ID}`);

    expect(await heading('Programme A')).toBeTruthy();
    expect(screen.getByText('9am on 4 January 2027 (UK time)')).toBeTruthy();
    expect(screen.getByText('5pm on 14 January 2027 (UK time)')).toBeTruthy();
    expect(screen.getByText('£5,000 to £25,000')).toBeTruthy();
    expect(await heading('Who can apply', 2)).toBeTruthy();
    expect(screen.getByText('This programme is open to registered charities only.')).toBeTruthy();
    const next = encodeURIComponent(`/programmes/${ROUND_ID}`);
    expect(screen.getByRole('link', { name: 'Sign in to apply' })).toHaveProperty(
      'search',
      `?next=${next}`,
    );
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveProperty(
      'search',
      `?next=${next}`,
    );
    expect(sentTo(`/public/tenants/northfield/rounds/${ROUND_ID}`)?.credentials).toBe('omit');
  });

  it('leaves out Who can apply when there are no questions', async () => {
    stubApi({ 'GET /auth/session': signedOut, [ONE]: ok({ ...round, eligibility: [] }) });
    openPortal(`/northfield/open-grants/${ROUND_ID}`);

    expect(await heading('Programme A')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Who can apply' })).toBeNull();
  });

  it('offers a signed-in applicant to start, not to sign in', async () => {
    stubApi({ ...signedIn, [ONE]: ok(round) });
    openPortal(`/northfield/open-grants/${ROUND_ID}`);

    expect(await heading('Programme A')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Start an application' })).toHaveProperty(
      'pathname',
      `/northfield/programmes/${ROUND_ID}/start`,
    );
    expect(screen.queryByRole('link', { name: 'Sign in to apply' })).toBeNull();
  });

  it('shows the not found page for a 404, without echoing the round', async () => {
    stubApi({ 'GET /auth/session': signedOut, [ONE]: problem(404, 'Not found.') });
    openPortal(`/northfield/open-grants/${ROUND_ID}`);

    expect(await heading('Page not found')).toBeTruthy();
    expect(document.body.textContent).not.toContain(ROUND_ID);
  });
});
