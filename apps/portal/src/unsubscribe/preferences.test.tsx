// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The "How we contact you" page, opened through the portal so the sign-in
// check and the router are the real ones.

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { problem, stubApi } from '../testing/api.ts';
import { signedIn } from '../testing/party.ts';
import { expectTitle, openPortal, setUpPortalTests } from '../testing/render.tsx';

setUpPortalTests();

const KEY = '/portal/profile/preferences';
const LABEL = 'News about future funding rounds, by email';
const choices = (state: 'given' | 'withdrawn' | null) => ({
  status: 200,
  body: {
    preferences: [
      {
        purpose: 'future_funding',
        channel: 'email',
        state,
        recordedAt: state === null ? null : '2027-01-04T10:00:00.000Z',
      },
    ],
  },
});
const save = () => screen.getByRole('button', { name: 'Save my choice' });
const no = () => screen.findByRole<HTMLInputElement>('radio', { name: 'No' });

describe('How we contact you', () => {
  it('reads the choices and sends nothing until the person saves', async () => {
    const sent = stubApi({ ...signedIn, [`GET ${KEY}`]: choices('given') });
    openPortal('/northfield/preferences');

    await screen.findByRole('heading', { level: 1, name: 'How we contact you' });
    await expectTitle('How we contact you – Fairfold Grants');
    const group = await screen.findByRole('group', { name: LABEL });
    expect(within(group).getByRole<HTMLInputElement>('radio', { name: 'Yes' }).checked).toBe(true);
    expect(sent.map(({ key }) => key)).toEqual(['GET /auth/session', `GET ${KEY}`]);
  });

  it('saves one change without naming the person, and says what was saved', async () => {
    const user = userEvent.setup();
    const sent = stubApi({
      ...signedIn,
      [`GET ${KEY}`]: choices('given'),
      [`PUT ${KEY}`]: choices('withdrawn'),
    });
    openPortal('/northfield/preferences');

    await user.click(await no());
    await user.click(save());

    expect(await screen.findByText(`Saved. ${LABEL}: no.`)).toBeTruthy();
    expect(sent.at(-1)).toEqual({
      key: `PUT ${KEY}`,
      body: {
        purpose: 'future_funding',
        channel: 'email',
        state: 'withdrawn',
        privacyNoticeVersion: '1.0',
      },
    });
  });

  it('tells a person who unsubscribed that they can turn it back on', async () => {
    stubApi({ ...signedIn, [`GET ${KEY}`]: choices('withdrawn') });
    openPortal('/northfield/preferences');

    expect(
      await screen.findByText('You turned this off. You can turn it back on here.'),
    ).toBeTruthy();
    expect((await no()).checked).toBe(true);
  });

  it('asks for a choice, and sends nothing, when none was made', async () => {
    const user = userEvent.setup();
    const sent = stubApi({ ...signedIn, [`GET ${KEY}`]: choices(null) });
    openPortal('/northfield/preferences');
    await no();

    await user.click(save());

    expect(within(await screen.findByRole('alert')).getByText('Choose yes or no.')).toBeTruthy();
    expect(sent.some(({ key }) => key.startsWith('PUT'))).toBe(false);
  });

  it("shows the server's refusal in an error summary", async () => {
    const user = userEvent.setup();
    stubApi({
      ...signedIn,
      [`GET ${KEY}`]: choices('given'),
      [`PUT ${KEY}`]: problem(403, 'You cannot change this.'),
    });
    openPortal('/northfield/preferences');

    await user.click(await no());
    await user.click(save());

    expect(
      within(await screen.findByRole('alert')).getByText('You cannot change this.'),
    ).toBeTruthy();
  });

  it('offers to try again when the choices cannot be read', async () => {
    stubApi({ ...signedIn, [`GET ${KEY}`]: problem(503, 'Busy.') });
    openPortal('/northfield/preferences');

    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.getByText(/We could not load your choices/)).toBeTruthy();
  });

  it('sends a signed-out visitor to sign in first', async () => {
    stubApi({ 'GET /auth/session': problem(401, 'You are not signed in.') });
    openPortal('/northfield/preferences');

    await screen.findByRole('heading', { level: 1, name: 'Sign in' });
  });
});
