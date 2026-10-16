// SPDX-License-Identifier: AGPL-3.0-or-later

import { partyMessages } from '@pixel-scientists/party/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { problem, stubApi } from '../testing/api.ts';
import type { Reply } from '../testing/api.ts';
import { newProfile, ok, organisationList, profile, signedIn } from '../testing/party.ts';
import { expectTitle, openPortal, setUpPortalTests } from '../testing/render.tsx';

setUpPortalTests();

const GET = 'GET /portal/profile';
const PUT = 'PUT /portal/profile';
const heading = (name: string) => screen.findByRole('heading', { level: 1, name });
const box = (name: string) => screen.getByRole('textbox', { name });
/** The form shows once the details have loaded. */
const ready = () => screen.findByRole('textbox', { name: 'First name' });

describe('your details', () => {
  it('asks for a first name, a last name and an optional phone number, and shows the sign-in email', async () => {
    stubApi({ ...signedIn, [GET]: ok(newProfile) });
    openPortal('/northfield/profile');

    await heading('Your details');
    await expectTitle('Your details – Fairfold Grants');

    expect(box('First name').getAttribute('autocomplete')).toBe('given-name');
    expect(box('Last name').getAttribute('autocomplete')).toBe('family-name');
    const phone = box('Phone number (optional)');
    expect(phone.getAttribute('type')).toBe('tel');
    expect(phone.getAttribute('autocomplete')).toBe('tel');
    const main = screen.getByRole('main');
    expect(within(main).getByText('ada@example.org')).toBeTruthy();
    expect(
      within(main).getByText('This is the address you sign in with. You cannot change it here.'),
    ).toBeTruthy();
    expect(within(main).queryByRole('textbox', { name: /email/i })).toBeNull();
    expect(screen.getByRole('link', { name: 'Apply for a grant' }).getAttribute('href')).toBe(
      '/northfield/',
    );
  });

  it('shows what is saved', async () => {
    stubApi({ ...signedIn, [GET]: ok(profile({ phone: '01632 960 001' })) });
    openPortal('/northfield/profile');
    await ready();

    expect((box('First name') as HTMLInputElement).value).toBe('Ada');
    expect((box('Last name') as HTMLInputElement).value).toBe('Lovelace');
    expect((box('Phone number (optional)') as HTMLInputElement).value).toBe('01632 960 001');
  });

  it('saves the details, then goes back to the start page and says they are saved', async () => {
    const user = userEvent.setup();
    const sent = stubApi({
      ...signedIn,
      [GET]: ok(newProfile),
      [PUT]: ok(profile()),
      'GET /portal/organisations': organisationList(),
    });
    openPortal('/northfield/profile');
    await ready();

    await user.type(box('First name'), 'Ada');
    await user.type(box('Last name'), 'Lovelace');
    await user.click(screen.getByRole('button', { name: 'Save details' }));

    await heading('Apply for a grant');
    expect(sent.find(({ key }) => key === PUT)?.body).toEqual({
      givenName: 'Ada',
      familyName: 'Lovelace',
      phone: '',
    });
    expect(window.location.pathname + window.location.search).toBe('/northfield/?saved=details');
    expect(screen.getByText('Your details are saved.')).toBeTruthy();
  });

  it('checks the names with the contract before sending, and puts each message beside its field', async () => {
    const user = userEvent.setup();
    const sent = stubApi({ ...signedIn, [GET]: ok(newProfile) });
    openPortal('/northfield/profile');
    await ready();

    await user.click(screen.getByRole('button', { name: 'Save details' }));

    const summary = await screen.findByRole('alert', { name: 'There is a problem' });
    expect(within(summary).getByRole('link', { name: partyMessages.givenName })).toBeTruthy();
    expect(within(summary).getByRole('link', { name: partyMessages.familyName })).toBeTruthy();
    expect(box('First name').getAttribute('aria-invalid')).toBe('true');
    expect(box('First name').getAttribute('aria-describedby')).toContain('givenName-error');
    expect(sent.some(({ key }) => key === PUT)).toBe(false);
    await waitFor(() => {
      expect(document.activeElement).toBe(summary);
    });

    await user.click(within(summary).getByRole('link', { name: partyMessages.givenName }));
    expect(document.activeElement).toBe(box('First name'));
  });

  it('refuses a phone number that is not one, in the contract’s words', async () => {
    const user = userEvent.setup();
    stubApi({ ...signedIn, [GET]: ok(profile()) });
    openPortal('/northfield/profile');
    await ready();

    await user.type(box('Phone number (optional)'), 'call me');
    await user.click(screen.getByRole('button', { name: 'Save details' }));

    const summary = await screen.findByRole('alert', { name: 'There is a problem' });
    expect(within(summary).getByRole('link', { name: partyMessages.phone })).toBeTruthy();
  });

  it('shows what the API refuses beside the field, and keeps what was typed', async () => {
    const user = userEvent.setup();
    stubApi({
      ...signedIn,
      [GET]: ok(profile()),
      [PUT]: problem(400, 'Some fields are not valid.', [
        { field: 'body.givenName', message: 'Remove line breaks and hidden characters.' },
      ]),
    });
    openPortal('/northfield/profile');
    await ready();

    await user.type(box('First name'), '!');
    await user.click(screen.getByRole('button', { name: 'Save details' }));

    const summary = await screen.findByRole('alert', { name: 'There is a problem' });
    expect(within(summary).getByText('Remove line breaks and hidden characters.')).toBeTruthy();
    expect((box('First name') as HTMLInputElement).value).toBe('Ada!');
  });

  it('says it could not save, in plain words, when the service cannot be reached', async () => {
    const user = userEvent.setup();
    stubApi({ ...signedIn, [GET]: ok(profile()), [PUT]: problem(503, 'The service is busy.') });
    openPortal('/northfield/profile');
    await ready();

    await user.click(screen.getByRole('button', { name: 'Save details' }));

    expect(await screen.findByRole('alert', { name: 'There is a problem' })).toBeTruthy();
    expect(screen.getByText('The service is busy.')).toBeTruthy();
    expect((box('First name') as HTMLInputElement).value).toBe('Ada');
  });

  it('says it is saving while the request is on its way, and keeps focus on the button', async () => {
    const user = userEvent.setup();
    let answer: (reply: Reply) => void = () => undefined;
    stubApi({
      ...signedIn,
      [GET]: ok(profile()),
      [PUT]: () =>
        new Promise<Reply>((resolve) => {
          answer = resolve;
        }),
      'GET /portal/organisations': organisationList(),
    });
    openPortal('/northfield/profile');
    await ready();

    await user.click(screen.getByRole('button', { name: 'Save details' }));

    const pending = await screen.findByRole('button', { name: 'Saving…' });
    expect(pending.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(pending);
    answer(ok(profile()));
    await heading('Apply for a grant');
  });

  it('says so, and offers to try again, when the details cannot be loaded', async () => {
    const user = userEvent.setup();
    let reads = 0;
    stubApi({
      ...signedIn,
      [GET]: () => {
        reads += 1;
        return reads === 1 ? problem(503, 'Try again later.') : ok(profile());
      },
    });
    openPortal('/northfield/profile');

    await heading('Your details');
    expect(
      await screen.findByText(
        'We could not load this page. Check that you are online, then try again.',
      ),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => {
      expect((box('First name') as HTMLInputElement).value).toBe('Ada');
    });
  });

  it('sends someone who is not signed in to sign in, and brings them back', async () => {
    const user = userEvent.setup();
    stubApi({
      'GET /auth/session': problem(401, 'You are not signed in.'),
      'POST /auth/tenants/northfield/sign-in': {
        status: 200,
        body: signedIn['GET /auth/session'].body,
      },
      [GET]: ok(profile()),
    });
    openPortal('/northfield/profile');

    await heading('Sign in');
    expect(window.location.search).toBe('?next=%2Fprofile');
    await user.type(box('Email address'), 'ada@example.org');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await heading('Your details');
    expect(window.location.pathname).toBe('/northfield/profile');
  });
});
