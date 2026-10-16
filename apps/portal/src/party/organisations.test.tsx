// SPDX-License-Identifier: AGPL-3.0-or-later

import { identifierSchemeIds, partyMessages } from '@pixel-scientists/party/contracts';
import { messages } from '@pixel-scientists/domain/platform';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { problem, stubApi } from '../testing/api.ts';
import {
  ORGANISATION_ID,
  OTHER_ORGANISATION_ID,
  created,
  ok,
  organisation,
  organisationList,
  signedIn,
} from '../testing/party.ts';
import { expectTitle, openPortal, setUpPortalTests } from '../testing/render.tsx';

setUpPortalTests();

const LIST = 'GET /portal/organisations';
const CREATE = 'POST /portal/organisations';
const ONE = `/portal/organisations/${ORGANISATION_ID}`;
const heading = (name: string) => screen.findByRole('heading', { level: 1, name });
const box = (name: string) => screen.getByRole('textbox', { name });
const choice = (name: string) => screen.getByRole('combobox', { name });
const summary = () => screen.findByRole('alert', { name: 'There is a problem' });

describe('your organisations', () => {
  it('says there are none, and what to do', async () => {
    stubApi({ ...signedIn, [LIST]: organisationList() });
    openPortal('/northfield/organisations');

    expect(
      await screen.findByRole('heading', { level: 2, name: 'No organisations yet' }),
    ).toBeTruthy();
    await expectTitle('Your organisations – Fairfold Grants');
    expect(screen.getByRole('link', { name: 'Add your organisation' }).getAttribute('href')).toBe(
      '/northfield/organisations/new',
    );
  });

  it('lists each organisation with its type, and a way to change it', async () => {
    stubApi({
      ...signedIn,
      [LIST]: organisationList(
        organisation(),
        organisation({
          id: OTHER_ORGANISATION_ID,
          name: 'Eastmere Youth Club',
          legalForm: 'unincorporated_group',
        }),
      ),
    });
    openPortal('/northfield/organisations');

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Eastmere Community Garden' }),
    ).toBeTruthy();
    expect(screen.getByText('Registered charity')).toBeTruthy();
    expect(screen.getByText('Unincorporated group or club')).toBeTruthy();
    expect(
      screen
        .getByRole('link', { name: 'Change details for Eastmere Community Garden' })
        .getAttribute('href'),
    ).toBe(`/northfield/organisations/${ORGANISATION_ID}`);
    expect(screen.getByRole('link', { name: 'Add another organisation' })).toBeTruthy();
    expect(screen.getByRole('main').textContent).not.toMatch(/verif/i);
  });

  it.each([
    ['organisation-added', 'Your organisation is added.'],
    ['organisation-changed', 'Your organisation details are saved.'],
  ])('says what was saved after %s', async (saved, words) => {
    stubApi({ ...signedIn, [LIST]: organisationList(organisation()) });
    openPortal(`/northfield/organisations?saved=${saved}`);

    expect(await screen.findByText(words)).toBeTruthy();
  });

  it('says nothing for a word it does not know', async () => {
    stubApi({ ...signedIn, [LIST]: organisationList(organisation()) });
    openPortal('/northfield/organisations?saved=anything');

    await screen.findByRole('heading', { level: 2, name: 'Eastmere Community Garden' });
    expect(screen.queryByText(/saved|added/i)).toBeNull();
  });

  it('offers to try again when the list cannot be loaded', async () => {
    stubApi({ ...signedIn, [LIST]: problem(503, 'Try again later.') });
    openPortal('/northfield/organisations');

    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

describe('adding an organisation', () => {
  async function open() {
    const sent = stubApi({
      ...signedIn,
      [LIST]: organisationList(),
      [CREATE]: created(organisation()),
    });
    openPortal('/northfield/organisations/new');
    await heading('Add your organisation');
    return sent;
  }

  it('asks for the name, type, registration numbers, address and website, with the country set to the United Kingdom', async () => {
    await open();

    await expectTitle('Add your organisation – Fairfold Grants');
    expect(box('Organisation name')).toBeTruthy();
    expect(within(choice('Type of organisation')).getAllByRole('option')).toHaveLength(9);
    expect(screen.getByRole('group', { name: 'Registration numbers' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Number 1' })).toBeNull();
    const address = screen.getByRole('group', { name: 'Registered address' });
    expect(within(address).getByRole('textbox', { name: 'Address line 1' })).toBeTruthy();
    expect(
      within(address).getByRole('textbox', { name: 'Address line 2 (optional)' }),
    ).toBeTruthy();
    expect(within(address).getByRole('textbox', { name: 'Town or city' })).toBeTruthy();
    expect(within(address).getByRole('textbox', { name: 'Postcode' })).toBeTruthy();
    expect((choice('Country') as HTMLSelectElement).value).toBe('GB');
    expect(within(choice('Country')).getByRole('option', { name: 'United Kingdom' })).toBeTruthy();
    expect(box('Website (optional)').getAttribute('type')).toBe('url');
    expect(screen.getByRole('link', { name: 'Your organisations' }).getAttribute('href')).toBe(
      '/northfield/organisations',
    );
  });

  it('adds a number from a list in plain words, and takes focus there', async () => {
    const user = userEvent.setup();
    await open();

    await user.click(screen.getByRole('button', { name: 'Add a charity or company number' }));

    const group = screen.getByRole('group', { name: 'Number 1' });
    const type = within(group).getByRole('combobox', { name: 'Type of number' });
    expect(document.activeElement).toBe(type);
    expect((type as HTMLSelectElement).value).toBe('GB-CHC');
    expect(
      within(type).getByRole('option', { name: 'Registered charity in England and Wales' }),
    ).toBeTruthy();
    expect(within(group).getByRole('textbox', { name: 'Number' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add another number' })).toBeTruthy();
  });

  it('offers each type once, and no more numbers when every type is used', async () => {
    const user = userEvent.setup();
    await open();

    for (let count = 0; count < identifierSchemeIds.length; count += 1) {
      await user.click(
        screen.getByRole('button', { name: /^Add (a charity or company|another) number$/ }),
      );
    }

    expect(screen.queryByRole('button', { name: /^Add (a charity|another)/ })).toBeNull();
    const second = within(screen.getByRole('group', { name: 'Number 2' })).getByRole('combobox');
    expect((second as HTMLSelectElement).value).toBe('GB-SC');
    expect(
      within(second).queryByRole('option', { name: 'Registered charity in England and Wales' }),
    ).toBeNull();
  });

  it('removes a number, and puts focus on the button that adds one', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('button', { name: 'Add a charity or company number' }));

    await user.click(screen.getByRole('button', { name: 'Remove number 1' }));

    expect(screen.queryByRole('group', { name: 'Number 1' })).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Add a charity or company number' }),
    );
  });

  it('checks everything with the contract before sending, in its words, and sends nothing', async () => {
    const user = userEvent.setup();
    const sent = await open();
    await user.click(screen.getByRole('button', { name: 'Add a charity or company number' }));
    await user.type(box('Number'), '12');
    await user.type(box('Postcode'), 'nowhere');
    await user.type(box('Website (optional)'), 'http://example.org');

    await user.click(screen.getByRole('button', { name: 'Add organisation' }));

    const problems = await summary();
    for (const message of [
      partyMessages.organisationName,
      messages.chooseAllowedValue,
      partyMessages.charityNumber,
      partyMessages.addressLine,
      partyMessages.town,
      partyMessages.postcode,
      partyMessages.website,
    ]) {
      expect(within(problems).getByRole('link', { name: message })).toBeTruthy();
    }
    expect(sent.some(({ key }) => key === CREATE)).toBe(false);
    expect(box('Number').getAttribute('aria-invalid')).toBe('true');
    expect(box('Number').getAttribute('aria-describedby')).toContain(
      'identifiers.0.identifier-error',
    );

    await user.click(within(problems).getByRole('link', { name: partyMessages.charityNumber }));
    expect(document.activeElement).toBe(box('Number'));
  });

  it('sends the organisation as the contract reads it, then lists it with a notice', async () => {
    const user = userEvent.setup();
    const sent = await open();
    await user.type(box('Organisation name'), ' Eastmere Community Garden ');
    await user.selectOptions(choice('Type of organisation'), 'registered_charity');
    await user.click(screen.getByRole('button', { name: 'Add a charity or company number' }));
    await user.type(box('Number'), '1 187 654');
    await user.type(box('Address line 1'), '12 Mill Lane');
    await user.type(box('Town or city'), 'Eastmere');
    await user.type(box('Postcode'), 'ea12st');
    await user.type(box('Website (optional)'), 'https://eastmere.example.org');

    await user.click(screen.getByRole('button', { name: 'Add organisation' }));

    await heading('Your organisations');
    expect(sent.find(({ key }) => key === CREATE)?.body).toEqual({
      name: 'Eastmere Community Garden',
      legalForm: 'registered_charity',
      identifiers: [{ scheme: 'GB-CHC', identifier: '1187654' }],
      registeredAddress: {
        line1: '12 Mill Lane',
        line2: '',
        town: 'Eastmere',
        postcode: 'EA1 2ST',
        countryCode: 'GB',
      },
      website: 'https://eastmere.example.org/',
    });
    expect(window.location.pathname + window.location.search).toBe(
      '/northfield/organisations?saved=organisation-added',
    );
    expect(await screen.findByText('Your organisation is added.')).toBeTruthy();
  });

  it('sends an organisation with no numbers and no website', async () => {
    const user = userEvent.setup();
    const sent = await open();
    await user.type(box('Organisation name'), 'Eastmere Youth Club');
    await user.selectOptions(choice('Type of organisation'), 'unincorporated_group');
    await user.type(box('Address line 1'), '1 High Street');
    await user.type(box('Town or city'), 'Eastmere');
    await user.type(box('Postcode'), 'EA1 1AA');

    await user.click(screen.getByRole('button', { name: 'Add organisation' }));

    await heading('Your organisations');
    expect(sent.find(({ key }) => key === CREATE)?.body).toMatchObject({
      identifiers: [],
      website: '',
    });
  });

  it('shows what the API refuses beside its field', async () => {
    const user = userEvent.setup();
    stubApi({
      ...signedIn,
      [CREATE]: problem(400, 'Some fields are not valid.', [
        { field: 'body.registeredAddress.postcode', message: partyMessages.postcodeAbroad },
      ]),
    });
    openPortal('/northfield/organisations/new');
    await heading('Add your organisation');
    await user.type(box('Organisation name'), 'Eastmere Youth Club');
    await user.selectOptions(choice('Type of organisation'), 'unincorporated_group');
    await user.type(box('Address line 1'), '1 High Street');
    await user.type(box('Town or city'), 'Eastmere');
    await user.type(box('Postcode'), 'EA1 1AA');

    await user.click(screen.getByRole('button', { name: 'Add organisation' }));

    const problems = await summary();
    expect(within(problems).getByRole('link', { name: partyMessages.postcodeAbroad })).toBeTruthy();
    expect(box('Postcode').getAttribute('aria-invalid')).toBe('true');
    expect((box('Organisation name') as HTMLInputElement).value).toBe('Eastmere Youth Club');
  });

  it('keeps a number with the type it was given when another number is removed', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('button', { name: 'Add a charity or company number' }));
    await user.click(screen.getByRole('button', { name: 'Add another number' }));
    await user.type(
      within(screen.getByRole('group', { name: 'Number 2' })).getByRole('textbox'),
      'SC012345',
    );

    await user.click(screen.getByRole('button', { name: 'Remove number 1' }));

    const group = screen.getByRole('group', { name: 'Number 1' });
    expect(within(group).getByRole<HTMLSelectElement>('combobox').value).toBe('GB-SC');
    expect(within(group).getByRole<HTMLInputElement>('textbox').value).toBe('SC012345');
  });
});

describe('changing an organisation', () => {
  it('shows what is saved, with its numbers, and saves a change', async () => {
    const user = userEvent.setup();
    const sent = stubApi({
      ...signedIn,
      [`GET ${ONE}`]: ok(organisation({ website: 'https://eastmere.example.org/' })),
      [`PUT ${ONE}`]: ok(organisation({ name: 'Eastmere Garden Trust' })),
      [LIST]: organisationList(organisation({ name: 'Eastmere Garden Trust' })),
    });
    openPortal(`/northfield/organisations/${ORGANISATION_ID}`);
    await heading('Change organisation details');

    expect(
      (await screen.findByRole<HTMLInputElement>('textbox', { name: 'Organisation name' })).value,
    ).toBe('Eastmere Community Garden');
    expect((choice('Type of organisation') as HTMLSelectElement).value).toBe('registered_charity');
    const group = screen.getByRole('group', { name: 'Number 1' });
    expect(
      within(group).getByRole<HTMLSelectElement>('combobox', { name: 'Type of number' }).value,
    ).toBe('GB-CHC');
    expect(within(group).getByRole<HTMLInputElement>('textbox', { name: 'Number' }).value).toBe(
      '1187654',
    );
    expect((box('Address line 1') as HTMLInputElement).value).toBe('12 Mill Lane');
    expect((box('Postcode') as HTMLInputElement).value).toBe('EA1 2ST');
    expect((box('Website (optional)') as HTMLInputElement).value).toBe(
      'https://eastmere.example.org/',
    );

    await user.clear(box('Organisation name'));
    await user.type(box('Organisation name'), 'Eastmere Garden Trust');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await heading('Your organisations');
    expect(sent.find(({ key }) => key === `PUT ${ONE}`)?.body).toMatchObject({
      name: 'Eastmere Garden Trust',
      identifiers: [{ scheme: 'GB-CHC', identifier: '1187654' }],
    });
    expect(await screen.findByText('Your organisation details are saved.')).toBeTruthy();
  });

  it('says it cannot find an organisation that is not the person’s, and offers the list', async () => {
    stubApi({ ...signedIn, [`GET ${ONE}`]: problem(404, 'Not found.') });
    openPortal(`/northfield/organisations/${ORGANISATION_ID}`);

    expect(
      await screen.findByText('We cannot find this organisation. It may belong to someone else.'),
    ).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Go to your organisations' }).getAttribute('href'),
    ).toBe('/northfield/organisations');
  });

  it('says the page is not found for an address that is not an organisation’s', async () => {
    stubApi({ ...signedIn });
    openPortal('/northfield/organisations/not-an-id');

    expect(await heading('Page not found')).toBeTruthy();
  });

  it('offers to try again when the organisation cannot be loaded', async () => {
    const user = userEvent.setup();
    let reads = 0;
    stubApi({
      ...signedIn,
      [`GET ${ONE}`]: () => {
        reads += 1;
        return reads === 1 ? problem(503, 'Try again later.') : ok(organisation());
      },
    });
    openPortal(`/northfield/organisations/${ORGANISATION_ID}`);

    await user.click(await screen.findByRole('button', { name: 'Try again' }));

    await waitFor(() => {
      expect((box('Organisation name') as HTMLInputElement).value).toBe(
        'Eastmere Community Garden',
      );
    });
  });
});
