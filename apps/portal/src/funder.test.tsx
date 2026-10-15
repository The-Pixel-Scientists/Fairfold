// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  FUNDER,
  applicantSession,
  funderReply,
  problem,
  signedOut,
  stubApi,
} from './testing/api.ts';
import type { Reply } from './testing/api.ts';
import { expectTitle, openPortal, setUpPortalTests } from './testing/render.tsx';

setUpPortalTests();

const heading = (name: string) => screen.findByRole('heading', { level: 1, name });
const sheets = () =>
  Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[data-tenant-theme]')).map(
    (sheet) => sheet.getAttribute('href'),
  );

describe("the funder's name and look", () => {
  it("applies the funder's stylesheet and preset to every page, from the slug in the address", async () => {
    stubApi({ 'GET /auth/session': signedOut, [FUNDER]: funderReply({ preset: 'rounded' }) });
    openPortal('/northfield/sign-in');

    await heading('Sign in');

    await waitFor(() => {
      expect(sheets()).toEqual(['/api/public/tenants/northfield/theme.css']);
    });
    expect(document.documentElement.dataset['preset']).toBe('rounded');
  });

  it("shows the funder's name in the header when it has no logo, and on the start page", async () => {
    stubApi({ 'GET /auth/session': signedOut });
    openPortal('/northfield/');

    await heading('Apply for a grant');

    expect(within(screen.getByRole('banner')).getByText('Northfield Foundation')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
    expect(
      screen.getByText(
        'Create an account with your email address. Then you can see which grants Northfield Foundation has open and start an application.',
      ),
    ).toBeTruthy();
  });

  it("shows the funder's logo in the header, with the name as its alternative text", async () => {
    stubApi({ 'GET /auth/session': signedOut, [FUNDER]: funderReply({ hasLogo: true }) });
    openPortal('/northfield/');

    await heading('Apply for a grant');

    const logo = await within(screen.getByRole('banner')).findByRole('img', {
      name: 'Northfield Foundation',
    });
    expect(logo.getAttribute('src')).toBe('/api/public/tenants/northfield/logo');
  });

  it("shows the logo beside the signed-in applicant's email address", async () => {
    stubApi({
      'GET /auth/session': { status: 200, body: applicantSession() },
      [FUNDER]: funderReply({ hasLogo: true }),
    });
    openPortal('/northfield/');

    await heading('Apply for a grant');

    const banner = screen.getByRole('banner');
    expect(await within(banner).findByRole('img', { name: 'Northfield Foundation' })).toBeTruthy();
    expect(within(banner).getByText('ada@example.org')).toBeTruthy();
  });

  it('waits for the look before showing the page, so it is drawn once', async () => {
    let answer: (reply: Reply) => void = () => undefined;
    stubApi({
      'GET /auth/session': signedOut,
      [FUNDER]: () =>
        new Promise<Reply>((resolve) => {
          answer = resolve;
        }),
    });
    openPortal('/northfield/');

    expect(await heading('One moment')).toBeTruthy();
    answer(funderReply());
    expect(await heading('Apply for a grant')).toBeTruthy();
  });

  it('keeps the standard look, and works, when the funder cannot be read', async () => {
    stubApi({ 'GET /auth/session': signedOut, [FUNDER]: problem(503, 'Try again later.') });
    openPortal('/northfield/');

    await heading('Apply for a grant');

    expect(sheets()).toEqual([]);
    expect(document.documentElement.dataset['preset']).toBeUndefined();
    expect(screen.getByRole('link', { name: 'Create an account' })).toBeTruthy();
    expect(
      screen.getByText(/which grants the funder has open and start an application/),
    ).toBeTruthy();
  });

  it('shows no look or name on the pages outside a funder', async () => {
    stubApi({});
    openPortal('/');

    await heading("Use your funder's link");

    expect(sheets()).toEqual([]);
    expect(screen.queryByText('Northfield Foundation')).toBeNull();
  });
});

describe('a funder that does not exist', () => {
  async function open(path = '/northfield/') {
    stubApi({ 'GET /auth/session': signedOut, [FUNDER]: problem(404, 'Not found.') });
    openPortal(path);
    await heading('We cannot find this funder');
  }

  it('says so, and how to fix it, with a title, and takes focus', async () => {
    await open();

    expect(screen.getByText('Check the link you were given.')).toBeTruthy();
    expect(
      screen.getByText('If you do not have the link, ask the funder to send it to you again.'),
    ).toBeTruthy();
    await expectTitle('We cannot find this funder – Fairfold Grants');
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { level: 1, name: 'We cannot find this funder' }),
      );
    });
  });

  it('shows nothing that needs a funder, on any page of its address', async () => {
    await open('/northfield/sign-in');

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Create an account' })).toBeNull();
    expect(sheets()).toEqual([]);
  });
});
