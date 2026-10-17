// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { problem, stubApi } from '../testing/api.ts';
import {
  consent,
  newProfile,
  ok,
  organisation,
  organisationList,
  profile,
  signedIn,
} from '../testing/party.ts';
import { openPortal, setUpPortalTests } from '../testing/render.tsx';

setUpPortalTests();

const PROFILE = 'GET /portal/profile';
const ORGANISATIONS = 'GET /portal/organisations';

async function tasks() {
  const list = await screen.findByRole('list', { name: 'Get ready to apply' });
  return within(list)
    .getAllByRole('listitem')
    .map((item) => item.textContent);
}

describe('get ready to apply', () => {
  it('lists each thing to do on the start page, with a link and where the applicant has got to', async () => {
    stubApi({ ...signedIn, [PROFILE]: ok(newProfile), [ORGANISATIONS]: organisationList() });
    openPortal('/northfield/');

    expect(await tasks()).toEqual([
      'Your detailsYour name and phone number.Not started',
      'Your organisationsThe charity or group you apply for.Not started',
      'Future fundingOptional. Choose whether we can email you about new grants.Not started',
    ]);
    expect(screen.getByRole('link', { name: 'Your details' }).getAttribute('href')).toBe(
      '/northfield/profile',
    );
    expect(screen.getByRole('link', { name: 'Your organisations' }).getAttribute('href')).toBe(
      '/northfield/organisations',
    );
    expect(screen.getByRole('link', { name: 'Future funding' }).getAttribute('href')).toBe(
      '/northfield/future-funding',
    );
    expect(screen.getByRole('link', { name: 'Programmes you can apply to' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Your applications' }).getAttribute('href')).toBe(
      '/northfield/applications',
    );
  });

  it('marks what is done, including a choice about future funding of either kind', async () => {
    stubApi({
      ...signedIn,
      [PROFILE]: ok(profile({ consents: [consent('withdrawn')] })),
      [ORGANISATIONS]: organisationList(organisation()),
    });
    openPortal('/northfield/');

    expect((await tasks()).map((text) => text.slice(-9))).toEqual([
      'Completed',
      'Completed',
      'Completed',
    ]);
  });

  it('shows a notice for what was just saved', async () => {
    stubApi({ ...signedIn, [PROFILE]: ok(profile()), [ORGANISATIONS]: organisationList() });
    openPortal('/northfield/?saved=details');

    expect(await screen.findByText('Your details are saved.')).toBeTruthy();
  });

  it('says it could not check, and still offers the links, when the progress cannot be read', async () => {
    stubApi({
      ...signedIn,
      [PROFILE]: problem(503, 'Try again later.'),
      [ORGANISATIONS]: organisationList(),
    });
    openPortal('/northfield/');

    expect(await screen.findByText('We could not check how far you have got.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Your details' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Future funding' })).toBeTruthy();
    expect(screen.queryByText('Not started')).toBeNull();
  });

  it('is not shown to a visitor who has not signed in', async () => {
    stubApi({ 'GET /auth/session': problem(401, 'You are not signed in.') });
    openPortal('/northfield/');

    await screen.findByRole('link', { name: 'Create an account' });
    expect(screen.queryByRole('heading', { name: 'Get ready to apply' })).toBeNull();
  });
});
