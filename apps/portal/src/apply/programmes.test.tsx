// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Finding a programme, reading about its round and starting an application.

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { problem, stubApi } from '../testing/api.ts';
import {
  APPLICATION_ID,
  ROUND_ID,
  application,
  openRoundList,
  round,
  roundDetail,
} from '../testing/apply.ts';
import {
  ORGANISATION_ID,
  OTHER_ORGANISATION_ID,
  created,
  ok,
  organisation,
  organisationList,
  signedIn,
} from '../testing/party.ts';
import { openPortal, setUpPortalTests } from '../testing/render.tsx';

setUpPortalTests();

const heading = (name: string, level = 1) => screen.findByRole('heading', { level, name });

describe('programmes you can apply to', () => {
  it('lists each open round with its summary, closing time and award range', async () => {
    stubApi({ ...signedIn, 'GET /portal/rounds': openRoundList(round) });
    openPortal('/northfield/programmes');

    expect(await heading('Programmes you can apply to')).toBeTruthy();
    const card = (await heading('Community Spaces Fund', 2)).closest('li');
    if (card === null) throw new Error('The programme is not in a list.');
    expect(within(card).getByText('Spring 2027')).toBeTruthy();
    expect(
      within(card).getByText('Grants for community groups that bring people together.'),
    ).toBeTruthy();
    expect(within(card).getByText('5pm on 2 November 2026, UK time')).toBeTruthy();
    expect(within(card).getByText('£5,000 to £25,000')).toBeTruthy();
    expect(
      within(card).getByRole('link', { name: 'Read more and apply for Community Spaces Fund' }),
    ).toHaveProperty('pathname', `/northfield/programmes/${ROUND_ID}`);
    expect(document.title).toBe('Programmes you can apply to – Fairfold Grants');
  });

  it('says to check back later when no programme is open', async () => {
    stubApi({ ...signedIn, 'GET /portal/rounds': openRoundList() });
    openPortal('/northfield/programmes');

    expect(await heading('No programmes are open at the moment', 2)).toBeTruthy();
    expect(screen.getByText(/^Check back later\./)).toBeTruthy();
  });

  it('offers to try again when the programmes cannot be read', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    stubApi({
      ...signedIn,
      'GET /portal/rounds': () => {
        attempts += 1;
        return attempts === 1 ? problem(503, 'Try later.') : openRoundList(round);
      },
    });
    openPortal('/northfield/programmes');

    await user.click(await screen.findByRole('button', { name: 'Try again' }));

    expect(await heading('Community Spaces Fund', 2)).toBeTruthy();
  });

  it('is reached from the start page', async () => {
    const user = userEvent.setup();
    stubApi({
      ...signedIn,
      'GET /portal/profile': ok({
        givenName: 'Ada',
        familyName: 'Lovelace',
        email: 'ada@example.org',
        phone: null,
        consents: [],
      }),
      'GET /portal/organisations': organisationList(),
      'GET /portal/rounds': openRoundList(round),
    });
    openPortal('/northfield/');

    await user.click(await screen.findByRole('link', { name: 'Programmes you can apply to' }));

    expect(await heading('Programmes you can apply to')).toBeTruthy();
  });
});

describe('a round', () => {
  const reads = { ...signedIn, [`GET /portal/rounds/${ROUND_ID}`]: roundDetail() };

  it('says what the fund is for, who it cannot help, how much, when it closes and what to have ready', async () => {
    stubApi(reads);
    openPortal(`/northfield/programmes/${ROUND_ID}`);

    expect(await heading('Community Spaces Fund')).toBeTruthy();
    expect(screen.getByText('5pm on 2 November 2026, UK time')).toBeTruthy();
    expect(screen.getByText('£5,000 to £25,000')).toBeTruthy();
    expect(screen.getByText('We pay for the everyday costs of a project.')).toBeTruthy();
    expect(screen.getByText('We fund halls, equipment and training.')).toBeTruthy();
    expect(screen.getByText('This programme is open to registered charities only.')).toBeTruthy();
    expect(screen.getByText(/^It takes about 15 minutes\./)).toBeTruthy();
    expect(screen.getByText('Your latest accounts')).toBeTruthy();
    expect(screen.getByText('Costs of the project')).toBeTruthy();
    expect(screen.getByText('We save your answers to your account, ada@example.org.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Start application' })).toHaveProperty(
      'pathname',
      `/northfield/programmes/${ROUND_ID}/start`,
    );
    await waitFor(() => {
      expect(document.title).toBe('Community Spaces Fund – Fairfold Grants');
    });
  });

  it('keeps its heading while it loads, so focus is not lost', async () => {
    stubApi(reads);
    openPortal(`/northfield/programmes/${ROUND_ID}`);

    const loading = await heading('Programme');
    const loaded = await heading('Community Spaces Fund');

    expect(loaded).toBe(loading);
  });

  it('says a round that is not open cannot be found', async () => {
    stubApi({ ...signedIn, [`GET /portal/rounds/${ROUND_ID}`]: problem(404, 'Not found.') });
    openPortal(`/northfield/programmes/${ROUND_ID}`);

    expect(await screen.findByText(/^This programme is not taking applications\./)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See programmes you can apply to' })).toBeTruthy();
  });

  it('is not found at an address that is not a round’s id', async () => {
    stubApi(signedIn);
    openPortal('/northfield/programmes/not-an-id');

    expect(await heading('Page not found')).toBeTruthy();
  });
});

describe('who is applying', () => {
  const start = `/northfield/programmes/${ROUND_ID}/start`;
  const reads = { ...signedIn, [`GET /portal/rounds/${ROUND_ID}`]: roundDetail() };

  it('starts the application for the only organisation, without asking again', async () => {
    const user = userEvent.setup();
    const sent = stubApi({
      ...reads,
      'GET /portal/organisations': organisationList(organisation()),
      [`POST /portal/rounds/${ROUND_ID}/applications`]: created(application()),
      [`GET /portal/applications/${APPLICATION_ID}`]: ok(application()),
    });
    openPortal(start);

    const chosen = await screen.findByRole('radio', { name: /Eastmere Community Garden/ });
    expect(chosen).toHaveProperty('checked', true);
    await user.click(screen.getByRole('button', { name: 'Start application' }));

    expect(await heading('Your application')).toBeTruthy();
    expect(window.location.pathname).toBe(`/northfield/applications/${APPLICATION_ID}`);
    expect(sent.find(({ key }) => key.startsWith('POST'))?.body).toEqual({
      organisationId: ORGANISATION_ID,
    });
  });

  it('asks which organisation when there are several, and says what to do if none is chosen', async () => {
    const user = userEvent.setup();
    const sent = stubApi({
      ...reads,
      'GET /portal/organisations': organisationList(
        organisation(),
        organisation({ id: OTHER_ORGANISATION_ID, name: 'Eastmere Youth Club' }),
      ),
      [`POST /portal/rounds/${ROUND_ID}/applications`]: created(application()),
      [`GET /portal/applications/${APPLICATION_ID}`]: ok(application()),
    });
    openPortal(start);

    await user.click(await screen.findByRole('button', { name: 'Start application' }));

    const summary = await screen.findByRole('alert', { name: 'There is a problem' });
    expect(within(summary).getByText('Choose the organisation that is applying.')).toBeTruthy();
    expect(sent.some(({ key }) => key.startsWith('POST'))).toBe(false);

    await user.click(screen.getByRole('radio', { name: /Eastmere Youth Club/ }));
    await user.click(screen.getByRole('button', { name: 'Start application' }));

    await heading('Your application');
    expect(sent.find(({ key }) => key.startsWith('POST'))?.body).toEqual({
      organisationId: OTHER_ORGANISATION_ID,
    });
  });

  it('links to add an organisation when there is none', async () => {
    stubApi({ ...reads, 'GET /portal/organisations': organisationList() });
    openPortal(start);

    expect(await heading('Add your organisation first', 2)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Add your organisation' })).toHaveProperty(
      'pathname',
      '/northfield/organisations/new',
    );
    expect(screen.queryByRole('button', { name: 'Start application' })).toBeNull();
  });

  it('shows the API’s words when the organisation already has an application', async () => {
    const user = userEvent.setup();
    stubApi({
      ...reads,
      'GET /portal/organisations': organisationList(organisation()),
      [`POST /portal/rounds/${ROUND_ID}/applications`]: problem(
        409,
        'This organisation has already started an application for this round.',
      ),
    });
    openPortal(start);

    await user.click(await screen.findByRole('button', { name: 'Start application' }));

    expect(
      await screen.findByText(
        'This organisation has already started an application for this round.',
      ),
    ).toBeTruthy();
    expect(window.location.pathname).toBe(start);
  });
});
