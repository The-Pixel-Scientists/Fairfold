// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { problem, stubApi } from '../testing/api.ts';
import { expectTitle, openPortal, setUpPortalTests } from '../testing/render.tsx';
import { whatStops } from './wording.ts';

setUpPortalTests();

const TOKEN = 'dGVzdC10b2tlbi1mb3Itc3ludGhldGljLWRhdGEtb25seS0wMDAx';
const KEY = `/public/unsubscribe?token=${TOKEN}`;
const GET = `GET ${KEY}`;
const POST = `POST ${KEY}`;
const target = { status: 200, body: { purpose: 'future_funding', channel: 'email' } };
const heading = (name: string) => screen.findByRole('heading', { level: 1, name });
const press = () => screen.findByRole('button', { name: 'Unsubscribe from these emails' });
const REFUSED = 'This link has expired or is not valid';

function open(token: string | null = TOKEN) {
  openPortal(`/northfield/unsubscribe${token === null ? '' : `?token=${token}`}`);
}

describe('unsubscribe wording', () => {
  it('says what stops', () => {
    expect(whatStops('future_funding', 'email')).toBe('emails about future funding');
  });
});

describe('unsubscribe page', () => {
  it('reads what the link stops with one GET and posts nothing on load', async () => {
    const sent = stubApi({ [GET]: target });
    open();

    await heading('Stop emails about future funding');
    await expectTitle('Unsubscribe – Fairfold Grants');
    expect(sent.map(({ key }) => key)).toEqual([GET]);
    expect(await press()).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Change how we contact you' }).getAttribute('href'),
    ).toBe('/northfield/preferences');
  });

  it('sends no credentials and no session or funder request', async () => {
    const sent = stubApi({
      [GET]: target,
      [POST]: { status: 200, body: { outcome: 'unsubscribed' } },
    });
    open();
    await press();

    const fetched = vi.mocked(fetch).mock.calls;
    expect(fetched.every(([, init]) => init?.credentials === 'omit')).toBe(true);
    expect(sent.some(({ key }) => key.includes('/auth/') || key.includes('/public/tenants'))).toBe(
      false,
    );
  });

  it.each(['unsubscribed', 'already_unsubscribed'])(
    'confirms with the same calm words for %s',
    async (outcome) => {
      const user = userEvent.setup();
      const sent = stubApi({ [GET]: target, [POST]: { status: 200, body: { outcome } } });
      open();

      await user.click(await press());

      await heading('You have unsubscribed');
      expect(
        screen.getByText('You will not get emails about future funding from this funder.'),
      ).toBeTruthy();
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
      expect(sent[1]).toEqual({ key: POST, body: { 'List-Unsubscribe': 'One-Click' } });
    },
  );

  it('posts once for a double click', async () => {
    const user = userEvent.setup();
    const sent = stubApi({
      [GET]: target,
      [POST]: { status: 200, body: { outcome: 'unsubscribed' } },
    });
    open();

    const button = await press();
    await user.dblClick(button);
    await heading('You have unsubscribed');

    expect(sent.filter(({ key }) => key === POST)).toHaveLength(1);
  });

  it('gives one refusal for a bad link, and never repeats the token', async () => {
    stubApi({ [GET]: problem(404, 'Not found.') });
    open();

    await heading(REFUSED);
    expect(
      screen.getByText('Use the link in a newer email, or sign in to change how we contact you.'),
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain(TOKEN);
  });

  it('gives the same refusal without a request when the token is missing or malformed', async () => {
    const sent = stubApi({});
    open('short');

    await heading(REFUSED);
    expect(sent).toEqual([]);
  });

  it('gives the same refusal when the POST is refused', async () => {
    const user = userEvent.setup();
    stubApi({ [GET]: target, [POST]: problem(404, 'Not found.') });
    open();

    await user.click(await press());

    await heading(REFUSED);
  });

  it('shows the wait for a 429 and repeats only the GET on Try again', async () => {
    const user = userEvent.setup();
    const sent = stubApi({
      [GET]: { ...problem(429, 'Slow down.'), headers: { 'retry-after': '30' } },
    });
    open();

    expect(
      await screen.findByText('Too many attempts. Wait 30 seconds, then try again.'),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('Too many attempts. Wait 30 seconds, then try again.');
    expect(sent.map(({ key }) => key)).toEqual([GET, GET]);
  });

  it('keeps the page and offers Try again when the POST fails, repeating only the POST', async () => {
    const user = userEvent.setup();
    const sent = stubApi({
      [GET]: target,
      [POST]: problem(500, 'Something went wrong.'),
    });
    open();

    await user.click(await press());

    expect((await screen.findByRole('alert')).textContent).toMatch(/We could not load this page/);
    await user.click(await press());
    await screen.findByRole('alert');
    expect(sent.map(({ key }) => key)).toEqual([GET, POST, POST]);
  });

  it('uses no storage and sets no cookie', async () => {
    const user = userEvent.setup();
    stubApi({ [GET]: target, [POST]: { status: 200, body: { outcome: 'unsubscribed' } } });
    open();
    await user.click(await press());
    await heading('You have unsubscribed');

    expect(document.cookie).toBe('');
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
