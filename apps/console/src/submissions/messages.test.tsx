// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { api as decisionApi, list as decisionList } from '../decisions/fixtures.ts';
import { problem, stubApi } from '../testing/api.ts';
import { openConsole, setUpConsoleTests } from '../testing/render.tsx';
import { adjustmentsFor, api, detail, manager, ok, page, programmes, uuid } from './fixtures.ts';

setUpConsoleTests();

const one = detail();
const DETAIL = `/northfield/submissions/${one.id}`;
const THREAD = `GET /console/submissions/${one.id}/messages`;
const READ = `POST /console/submissions/${one.id}/messages/read`;
const SEND = `POST /console/submissions/${one.id}/messages`;

const message = (n: number, change: object = {}) => ({
  id: uuid(1000 + n),
  side: 'applicant',
  body: `Synthetic message ${String(n)}`,
  sentAt: '2026-10-22T10:00:00.000Z',
  unread: false,
  authorName: null,
  ...change,
});

const detailReads = (extra = {}) => ({
  ...manager(),
  [api.programmes]: ok(programmes),
  [api.stages]: ok({ stages: [] }),
  [api.one(one.id)]: ok(one),
  [api.files(one.id)]: ok({ attachments: [] }),
  [api.list()]: ok(page([one])),
  [api.assignments(one.id)]: ok({ assignments: [] }),
  [api.adjustments(one.id)]: ok(adjustmentsFor([])),
  [decisionApi.list]: ok(decisionList([])),
  ...extra,
});

async function openMessages(user: ReturnType<typeof userEvent.setup>) {
  openConsole(DETAIL);
  await user.click(await screen.findByRole('tab', { name: 'Messages' }));
  return screen.findByRole('region', { name: 'Messages' });
}

describe('messages on a submission', () => {
  it('reads nothing until the member opens the section, then reads once', async () => {
    const user = userEvent.setup();
    const sent = stubApi(detailReads({ [THREAD]: ok({ messages: [], unreadCount: 0 }) }));
    openConsole(DETAIL);
    await screen.findByRole('tab', { name: 'Messages' });
    await screen.findByRole('heading', { level: 1, name: one.organisation.name });
    expect(sent.filter(({ key }) => key.includes('/messages'))).toEqual([]);

    await user.click(screen.getByRole('tab', { name: 'Messages' }));
    const panel = await screen.findByRole('region', { name: 'Messages' });
    expect(await within(panel).findByText(/No messages have been sent/)).toBeTruthy();
    expect(sent.filter(({ key }) => key === THREAD)).toHaveLength(1);
    expect(sent.some(({ key }) => key === READ)).toBe(false);
  });

  it('marks unread messages in words, marks the first as new, and keeps them while the thread cannot be marked read', async () => {
    const user = userEvent.setup();
    stubApi(
      detailReads({
        [THREAD]: ok({
          messages: [
            message(1),
            message(2, { unread: true }),
            message(3, { unread: true }),
            message(4, { side: 'staff', authorName: 'Ada Reed' }),
          ],
          unreadCount: 2,
        }),
        [READ]: problem(500, 'The service is busy. Try again.'),
      }),
    );
    const panel = await openMessages(user);

    const list = await within(panel).findByRole('list', { name: 'Messages, oldest first' });
    const items = within(list).getAllByRole('listitem');
    expect(items[1]?.textContent).toContain('New');
    expect(items[1]?.textContent).toContain('Unread');
    expect(items[2]?.textContent).not.toContain('New');
    expect(items[3]?.textContent).toContain('From the funder: Ada Reed');
    expect(items[0]?.textContent).toContain('From the applicant');
    expect(items[0]?.textContent).toContain('Synthetic message 1');

    expect(await within(panel).findByText('2 unread messages')).toBeTruthy();
  });

  it('marks the thread read once it is shown, as its own call, and clears the count', async () => {
    const user = userEvent.setup();
    const sent = stubApi(
      detailReads({
        [THREAD]: ok({
          messages: [message(1, { unread: true }), message(2, { unread: true })],
          unreadCount: 2,
        }),
        [READ]: { status: 204 },
      }),
    );
    const panel = await openMessages(user);

    expect(await within(panel).findByText('No unread messages')).toBeTruthy();
    expect(sent.filter(({ key }) => key === READ)).toHaveLength(1);
    expect(within(panel).queryByText('Unread')).toBeNull();
  });

  it('sends a reply as the funder, shows it last, and keeps the text out of the address and title', async () => {
    const user = userEvent.setup();
    const sent = stubApi(
      detailReads({
        [THREAD]: ok({ messages: [message(1)], unreadCount: 0 }),
        [SEND]: (body: unknown) => ({
          status: 201,
          body: message(2, {
            side: 'staff',
            authorName: 'Ada Reed',
            body: (body as { body: string }).body,
          }),
        }),
      }),
    );
    const panel = await openMessages(user);

    await user.type(
      await within(panel).findByRole('textbox', { name: 'Send message to applicant' }),
      'We have your accounts.',
    );
    expect(
      within(panel).getByText(/emailed that a message is waiting, without the message text/),
    ).toBeTruthy();
    await user.click(within(panel).getByRole('button', { name: 'Send message to applicant' }));

    const list = await within(panel).findByRole('list', { name: 'Messages, oldest first' });
    const last = within(list).getAllByRole('listitem')[1];
    expect(last?.textContent).toContain('We have your accounts.');
    expect(sent.find(({ key }) => key === SEND)?.body).toEqual({ body: 'We have your accounts.' });
    expect(within(panel).getByText('Message sent')).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement).toBe(last);
    });
    expect(window.location.href).not.toContain('accounts');
    expect(document.title).not.toContain('accounts');
  });

  it('refuses a blank reply and shows the server refusal, keeping the text', async () => {
    const user = userEvent.setup();
    stubApi(
      detailReads({
        [THREAD]: ok({ messages: [], unreadCount: 0 }),
        [SEND]: problem(422, 'Check the message and try again.', [
          { field: 'body.body', message: 'Write plain text without tags in angle brackets.' },
        ]),
      }),
    );
    const panel = await openMessages(user);
    const field = await within(panel).findByRole('textbox', { name: 'Send message to applicant' });
    const send = within(panel).getByRole('button', { name: 'Send message to applicant' });

    await user.click(send);
    expect(await within(panel).findByText(/Enter a message\./)).toBeTruthy();

    await user.type(field, 'Hello there');
    await user.click(send);
    expect(await within(panel).findByText(/Write plain text without tags/)).toBeTruthy();
    expect((field as HTMLTextAreaElement).value).toBe('Hello there');
  });

  it('says why the thread did not load and offers another go', async () => {
    const user = userEvent.setup();
    let reads = 0;
    stubApi(
      detailReads({
        [THREAD]: () => {
          reads += 1;
          return reads === 1
            ? problem(500, 'The messages did not load. Try again.')
            : ok({ messages: [], unreadCount: 0 });
        },
      }),
    );
    const panel = await openMessages(user);
    await user.click(await within(panel).findByRole('button', { name: 'Try again' }));
    expect(await within(panel).findByText(/No messages have been sent/)).toBeTruthy();
  });
});
