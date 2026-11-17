// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Messages with the funder about one application: who sent each one without
// naming staff, what is new, reading before marking read, plain-text bodies,
// one message per press of "Send message", the errors, and that a draft reply
// never leaves the page except through a send.

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { problem, stubApi } from '../testing/api.ts';
import { APPLICATION_ID, application, applicationServer } from '../testing/apply.ts';
import { message, messageServer, noThread } from '../testing/messages.ts';
import type { MessageServer } from '../testing/messages.ts';
import { signedIn } from '../testing/party.ts';
import { openPortal, setUpPortalTests } from '../testing/render.tsx';

setUpPortalTests();

const home = `/northfield/applications/${APPLICATION_ID}`;
const route = `/portal/applications/${APPLICATION_ID}/messages`;
const submitted = application({ status: 'submitted', submittedAt: '2026-10-21T12:00:00.000Z' });
const h1 = (name: string) => screen.findByRole('heading', { level: 1, name });
const box = () => screen.getByRole('textbox', { name: /Send a message to the funder/ });
const sendButton = () => screen.getByRole('button', { name: 'Send message' });

function open(path: string, thread: MessageServer, extra = {}) {
  const sent = stubApi({
    ...signedIn,
    ...applicationServer(submitted).handlers,
    ...thread.handlers,
    ...extra,
  });
  openPortal(path);
  return sent;
}

function sender(thread: MessageServer) {
  const post = thread.handlers[`POST ${route}`];
  if (post === undefined) throw new Error('No send handler.');
  return post;
}

const twoNew = () =>
  messageServer(
    APPLICATION_ID,
    message({ side: 'applicant', body: 'Can we change the start date?' }),
    message({ body: 'Yes, that is fine.', unread: true, sentAt: '2026-11-03T14:30:00.000Z' }),
    message({ body: 'Please send a bank letter.', unread: true }),
  );

describe('the thread', () => {
  it('shows each message from "You" or "The funder", oldest first, in UK time', async () => {
    open(`${home}/messages`, twoNew());

    expect(await h1('Messages')).toBeTruthy();
    await screen.findByText('Please send a bank letter.');
    const headings = screen.getAllByRole('heading', { level: 3 });
    expect(headings.map((heading) => heading.textContent)).toEqual([
      'You',
      'The funder',
      'The funder',
    ]);
    const items = headings.map((heading) => heading.closest('li'));
    expect(items[0]?.textContent).toContain('Can we change the start date?');
    expect(items[1]?.textContent).toContain('3 November 2026 at 2:30pm, UK time');
  });

  it('marks new messages in words, and says how many in the heading area', async () => {
    open(`${home}/messages`, twoNew());

    expect(await screen.findByText(/You have 2 new messages\./)).toBeTruthy();
    expect(screen.getAllByText('New')).toHaveLength(2);
  });

  it('says so plainly when there are no messages, and offers the reply form', async () => {
    open(`${home}/messages`, messageServer(APPLICATION_ID));

    expect(await screen.findByText(/There are no messages yet/)).toBeTruthy();
    expect(box()).toBeTruthy();
    expect(screen.queryByText(/new message/)).toBeNull();
  });

  it('marks the thread read once, after it is shown, and not when nothing is new', async () => {
    const thread = twoNew();
    open(`${home}/messages`, thread);
    await screen.findByText('Please send a bank letter.');
    await waitFor(() => {
      expect(thread.marked()).toBe(1);
    });
    expect(screen.getAllByText('New')).toHaveLength(2);
  });

  it('does not mark read when nothing is new', async () => {
    const none = messageServer(APPLICATION_ID, message({ body: 'Seen already.' }));
    open(`${home}/messages`, none);

    await screen.findByText('Seen already.');
    expect(none.marked()).toBe(0);
  });

  it('shows a body as plain text: no markup, no links', async () => {
    const body = 'See <b>this</b>\nhttps://example.org/x\n**bold**';
    open(`${home}/messages`, messageServer(APPLICATION_ID, message({ body })));

    const text = await screen.findByText(/See <b>this<\/b>/);
    expect(text.textContent).toBe(body);
    expect(text.querySelector('b, a')).toBeNull();
    expect(
      within(screen.getByRole('main')).queryByRole('link', { name: /example\.org/ }),
    ).toBeNull();
  });

  it('shows the not found screen for another applicant application, and marks nothing', async () => {
    const sent = stubApi({
      ...signedIn,
      ...applicationServer(submitted).handlers,
      ...noThread(APPLICATION_ID),
    });
    openPortal(`${home}/messages`);

    expect(await screen.findByText(/We cannot find this application/)).toBeTruthy();
    expect(sent.some(({ key }) => key.endsWith('/messages/read'))).toBe(false);
  });
});

describe('sending a reply', () => {
  it('adds the message to the thread, clears the box and says "Message sent"', async () => {
    const user = userEvent.setup();
    const thread = messageServer(APPLICATION_ID);
    open(`${home}/messages`, thread);
    await screen.findByText(/There are no messages yet/);

    await user.type(box(), 'Thank you.');
    await user.click(sendButton());

    expect(await screen.findByText('Message sent')).toBeTruthy();
    expect(thread.sends).toEqual(['Thank you.']);
    expect(screen.getByText('Thank you.')).toBeTruthy();
    expect(box()).toHaveProperty('value', '');
    expect(document.activeElement?.textContent).toBe('Message sent');
  });

  it('sends the same idempotency key on a retry, and a new one for a new message', async () => {
    const user = userEvent.setup();
    const thread = messageServer(APPLICATION_ID);
    const post = sender(thread);
    let tries = 0;
    open(`${home}/messages`, thread, {
      [`POST ${route}`]: (body: unknown) => {
        tries += 1;
        return tries === 1 ? problem(500, 'Failed.') : post(body);
      },
    });
    await screen.findByText(/There are no messages yet/);
    const keys = () =>
      vi
        .mocked(fetch)
        .mock.calls.filter(
          ([url, init]) =>
            typeof url === 'string' && url.endsWith('/messages') && init?.method === 'POST',
        )
        .map(([, init]) => new Headers(init?.headers).get('Idempotency-Key'));

    await user.type(box(), 'First.');
    await user.click(sendButton());
    expect((await screen.findAllByText(/Your message was not sent\./)).length).toBeGreaterThan(0);
    expect(box()).toHaveProperty('value', 'First.');

    await user.click(sendButton());
    await screen.findByText('Message sent');
    const [first, retry] = keys();
    expect(first).toBeTruthy();
    expect(retry).toBe(first);

    await user.type(box(), 'Second.');
    await user.click(sendButton());
    await waitFor(() => {
      expect(thread.sends).toEqual(['First.', 'Second.']);
    });
    expect(keys()[2]).not.toBe(first);
  });

  it('makes one message when the button is pressed twice', async () => {
    const user = userEvent.setup();
    const thread = messageServer(APPLICATION_ID);
    const post = sender(thread);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    open(`${home}/messages`, thread, {
      [`POST ${route}`]: (body: unknown) => held.then(() => post(body)),
    });
    await screen.findByText(/There are no messages yet/);

    await user.type(box(), 'Once.');
    await user.click(sendButton());
    await user.click(sendButton());
    release();

    await screen.findByText('Message sent');
    expect(thread.sends).toEqual(['Once.']);
  });

  it('refuses a blank message with the error summary, and sends nothing', async () => {
    const user = userEvent.setup();
    const sent = open(`${home}/messages`, messageServer(APPLICATION_ID));
    await screen.findByText(/There are no messages yet/);

    await user.type(box(), '   ');
    await user.click(sendButton());

    const summary = await screen.findByRole('alert');
    expect(within(summary).getByRole('link', { name: 'Enter a message.' })).toBeTruthy();
    expect(summary).toBe(document.activeElement);
    expect(sent.some(({ key }) => key === `POST ${route}`)).toBe(false);
  });

  it('refuses a message that is too long, in words', async () => {
    const user = userEvent.setup();
    open(`${home}/messages`, messageServer(APPLICATION_ID));
    await screen.findByText(/There are no messages yet/);

    await user.click(box());
    await user.paste('a'.repeat(2001));
    await user.click(sendButton());

    expect(
      await within(await screen.findByRole('alert')).findByText(
        /Your message must be 2,000 characters or fewer/,
      ),
    ).toBeTruthy();
  });

  it('shows the problem the server gives when it refuses, and keeps the text', async () => {
    const user = userEvent.setup();
    open(`${home}/messages`, messageServer(APPLICATION_ID), {
      [`POST ${route}`]: problem(422, 'You cannot send messages about this application.'),
    });
    await screen.findByText(/There are no messages yet/);

    await user.type(box(), 'Hello');
    await user.click(sendButton());

    expect(
      await within(await screen.findByRole('alert')).findByText(
        'You cannot send messages about this application.',
      ),
    ).toBeTruthy();
    expect(box()).toHaveProperty('value', 'Hello');
  });
});

describe('a reply that is not sent', () => {
  it('asks before the applicant leaves with words typed', async () => {
    const user = userEvent.setup();
    open(`${home}/messages`, messageServer(APPLICATION_ID));
    await screen.findByText(/There are no messages yet/);

    await user.type(box(), 'Not finished');
    await user.click(screen.getByRole('link', { name: 'Back to your application' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/You have not sent your message/)).toBeTruthy();
    expect(window.location.pathname).toBe(`${home}/messages`);
  });

  it('does not ask when nothing is typed', async () => {
    const user = userEvent.setup();
    open(`${home}/messages`, messageServer(APPLICATION_ID));
    await screen.findByText(/There are no messages yet/);

    await user.click(screen.getByRole('link', { name: 'Back to your application' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => {
      expect(window.location.pathname).toBe(home);
    });
  });

  it('is kept in no storage, address or page title', async () => {
    const user = userEvent.setup();
    open(`${home}/messages`, messageServer(APPLICATION_ID));
    await screen.findByText(/There are no messages yet/);

    await user.type(box(), 'Private words');

    expect(JSON.stringify(Object.entries(window.localStorage))).not.toContain('Private');
    expect(JSON.stringify(Object.entries(window.sessionStorage))).not.toContain('Private');
    expect(window.location.href).not.toContain('Private');
    expect(document.title).not.toContain('Private');
  });
});

describe('the link to the messages', () => {
  it('shows how many are new on the application page, in its name', async () => {
    open(home, twoNew());

    expect(await screen.findByRole('link', { name: /^Messages,\s*2 new$/ })).toHaveProperty(
      'pathname',
      `${home}/messages`,
    );
  });

  it('shows no count when none are new', async () => {
    open(home, messageServer(APPLICATION_ID, message()));

    expect(await screen.findByRole('link', { name: 'Messages' })).toBeTruthy();
  });

  it('is not shown for a draft', async () => {
    stubApi({ ...signedIn, ...applicationServer(application()).handlers });
    openPortal(home);

    await screen.findByText(/Do one section at a time/);
    expect(screen.queryByRole('link', { name: /^Messages/ })).toBeNull();
  });
});
