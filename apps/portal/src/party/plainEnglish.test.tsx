// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The words on each profile and organisation screen suit a reading age of
// about 11 (docs/CONTENT-STYLE.md): short sentences, buttons that say what
// happens, no apology or blame, and nothing about verification or anyone else.

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { FUNDER, problem, stubApi } from '../testing/api.ts';
import {
  ORGANISATION_ID,
  newProfile,
  ok,
  organisation,
  organisationList,
  profile,
  signedIn,
} from '../testing/party.ts';
import { openPortal, sentencesIn, setUpPortalTests } from '../testing/render.tsx';

setUpPortalTests();

/** The page has shown its heading and finished reading what it shows. */
async function settled() {
  await screen.findByRole('heading', { level: 1 });
  await waitFor(() => {
    expect(screen.getByRole('heading', { level: 1 }).textContent).not.toBe('One moment');
    expect(screen.queryByText(/^Loading/)).toBeNull();
  });
}

const reads = {
  ...signedIn,
  'GET /portal/profile': ok(newProfile),
  'GET /portal/organisations': organisationList(organisation()),
  [`GET /portal/organisations/${ORGANISATION_ID}`]: ok(organisation()),
};

const screens = [
  ['the start page for an applicant', '/northfield/', reads],
  ['your details', '/northfield/profile', reads],
  [
    'your details, saved',
    '/northfield/profile',
    { ...reads, 'GET /portal/profile': ok(profile()) },
  ],
  ['your organisations', '/northfield/organisations', reads],
  [
    'your organisations, with none',
    '/northfield/organisations',
    { ...reads, 'GET /portal/organisations': organisationList() },
  ],
  ['add your organisation', '/northfield/organisations/new', reads],
  ['change organisation details', `/northfield/organisations/${ORGANISATION_ID}`, reads],
  ['future funding', '/northfield/future-funding', reads],
  ['a funder that does not exist', '/northfield/', { ...reads, [FUNDER]: problem(404, 'No.') }],
] as const;

describe.each(screens)('%s', (_name, path, handlers) => {
  it('keeps every sentence short, and never apologises, blames the person or mentions checks', async () => {
    stubApi(handlers);
    openPortal(path);
    await settled();

    const main = screen.getByRole('main');
    for (const sentence of sentencesIn(main)) {
      expect(sentence.split(/\s+/).length, sentence).toBeLessThanOrEqual(25);
    }
    expect(main.textContent).not.toMatch(/sorry|apolog|your fault|invalid|verif|other applicants/i);
  });

  it('uses buttons and links that say what happens, never a bare "Submit" or "OK"', async () => {
    stubApi(handlers);
    openPortal(path);
    await settled();

    for (const control of [...screen.queryAllByRole('button'), ...screen.queryAllByRole('link')]) {
      expect(control.textContent).not.toMatch(/^(submit|ok|click here|here|next|save|add|edit)$/i);
    }
  });
});

describe('the words of an error', () => {
  it('say what is wrong and how to fix it, with no code', async () => {
    const user = userEvent.setup();
    stubApi({ ...signedIn, 'GET /portal/profile': ok(newProfile) });
    openPortal('/northfield/organisations/new');
    await screen.findByRole('heading', { level: 1, name: 'Add your organisation' });

    await user.click(screen.getByRole('button', { name: 'Add organisation' }));

    const summary = await screen.findByRole('alert', { name: 'There is a problem' });
    for (const item of summary.querySelectorAll('li')) {
      expect(item.textContent).toMatch(/^(Enter|Choose)/);
      expect(item.textContent).not.toMatch(/sorry|invalid|error|\b[A-Z]{4,}_/i);
    }
  });
});
