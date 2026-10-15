// SPDX-License-Identifier: AGPL-3.0-or-later

import { consentPurposes } from '@pixel-scientists/party/contracts';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { problem, stubApi } from '../testing/api.ts';
import {
  consent,
  created,
  newProfile,
  ok,
  organisationList,
  profile,
  signedIn,
} from '../testing/party.ts';
import { expectTitle, openPortal, setUpPortalTests } from '../testing/render.tsx';

setUpPortalTests();

const GET = 'GET /portal/profile';
const POST = 'POST /portal/profile/consents';
const heading = (name: string) => screen.findByRole('heading', { level: 1, name });
const yes = () =>
  screen.findByRole<HTMLInputElement>('radio', { name: 'Yes, email me about future funding' });
const no = () =>
  screen.findByRole<HTMLInputElement>('radio', {
    name: 'No, do not email me about future funding',
  });

describe('future funding', () => {
  it('is the only purpose, which the screens rely on until another is added', () => {
    expect(consentPurposes).toEqual(['future_funding']);
  });

  it('asks a yes or no question about email, names the funder, and shows the privacy notice version', async () => {
    stubApi({ ...signedIn, [GET]: ok(newProfile) });
    openPortal('/northfield/future-funding');

    await heading('Future funding');
    await expectTitle('Future funding – Fairfold Grants');
    const question = await screen.findByRole('group', {
      name: 'Can we email you about future funding?',
    });
    expect(within(question).getAllByRole('radio')).toHaveLength(2);
    expect((await yes()).checked).toBe(false);
    expect((await no()).checked).toBe(false);
    expect(
      screen.getByText(
        'Northfield Foundation may open new grants in the future. You can choose to hear about them.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('You have not chosen yet.')).toBeTruthy();
    expect(screen.getByText(/privacy notice version 1\.0/)).toBeTruthy();
  });

  it('offers only email, and no other channel', async () => {
    stubApi({ ...signedIn, [GET]: ok(newProfile) });
    openPortal('/northfield/future-funding');
    await yes();

    expect(screen.getByRole('main').textContent).not.toMatch(/text message|sms|phone call|post\b/i);
  });

  it('records a choice as a new consent with the version shown, then goes back with a notice', async () => {
    const user = userEvent.setup();
    const sent = stubApi({
      ...signedIn,
      [GET]: ok(newProfile),
      [POST]: created(consent('given')),
      'GET /portal/organisations': organisationList(),
    });
    openPortal('/northfield/future-funding');

    await user.click(await yes());
    await user.click(screen.getByRole('button', { name: 'Save my choice' }));

    await heading('Apply for a grant');
    expect(sent.find(({ key }) => key === POST)?.body).toEqual({
      purpose: 'future_funding',
      channel: 'email',
      state: 'given',
      privacyNoticeVersion: '1.0',
    });
    expect(window.location.pathname + window.location.search).toBe(
      '/northfield/?saved=future-funding',
    );
    expect(screen.getByText('Your choice is saved.')).toBeTruthy();
  });

  it('shows the current choice and when it was made, and records a change as another consent', async () => {
    const user = userEvent.setup();
    const sent = stubApi({
      ...signedIn,
      [GET]: ok(profile({ consents: [consent('given')] })),
      [POST]: created(consent('withdrawn')),
      'GET /portal/organisations': organisationList(),
    });
    openPortal('/northfield/future-funding');

    expect((await yes()).hasAttribute('checked') || (await yes()).checked).toBe(true);
    expect(screen.getByText('Your choice now: yes. You made it on 5 October 2026.')).toBeTruthy();
    await user.click(await no());
    await user.click(screen.getByRole('button', { name: 'Save my choice' }));

    await heading('Apply for a grant');
    expect(sent.find(({ key }) => key === POST)?.body).toMatchObject({ state: 'withdrawn' });
  });

  it('records nothing when the choice has not changed', async () => {
    const user = userEvent.setup();
    const sent = stubApi({
      ...signedIn,
      [GET]: ok(profile({ consents: [consent('given')] })),
      'GET /portal/organisations': organisationList(),
    });
    openPortal('/northfield/future-funding');
    await yes();

    await user.click(screen.getByRole('button', { name: 'Save my choice' }));

    await heading('Apply for a grant');
    expect(sent.some(({ key }) => key === POST)).toBe(false);
  });

  it('asks for a choice before saving anything, with the message beside the question', async () => {
    const user = userEvent.setup();
    const sent = stubApi({ ...signedIn, [GET]: ok(newProfile) });
    openPortal('/northfield/future-funding');
    await yes();

    await user.click(screen.getByRole('button', { name: 'Save my choice' }));

    const summary = await screen.findByRole('alert', { name: 'There is a problem' });
    expect(within(summary).getByRole('link', { name: 'Choose yes or no.' })).toBeTruthy();
    expect(
      screen.getByRole('group', { name: 'Can we email you about future funding?' }).textContent,
    ).toContain('Choose yes or no.');
    expect(sent.some(({ key }) => key === POST)).toBe(false);
  });

  it('says what went wrong when the choice cannot be saved, and keeps the choice', async () => {
    const user = userEvent.setup();
    stubApi({ ...signedIn, [GET]: ok(newProfile), [POST]: problem(503, 'The service is busy.') });
    openPortal('/northfield/future-funding');

    await user.click(await yes());
    await user.click(screen.getByRole('button', { name: 'Save my choice' }));

    expect(await screen.findByText('The service is busy.')).toBeTruthy();
    expect((await yes()).checked).toBe(true);
  });
});
