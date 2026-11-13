// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Stands in for the portal message routes for the specs: one application thread,
// which keeps what is sent and clears what is marked read, as the real API does.
// Give `handlers` to stubApply as `more`.

import { problem } from './auth-api.ts';
import type { Handler } from './auth-api.ts';

interface Message {
  id: string;
  side: 'applicant' | 'staff';
  body: string;
  sentAt: string;
  unread: boolean;
}

export interface MessagesStub {
  handlers: Record<string, Handler>;
  /** The body of each message it accepted. */
  sends: string[];
  /** How many times the thread was marked read. */
  marked: () => number;
}

let counter = 0;

export function message(overrides: Partial<Message> = {}): Message {
  counter += 1;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    side: 'staff',
    body: 'Hello.',
    sentAt: '2026-11-03T10:15:00.000Z',
    unread: false,
    ...overrides,
  };
}

/** The thread routes of one application, starting with `start`. */
export function stubMessages(applicationId: string, ...start: Message[]): MessagesStub {
  const path = `/portal/applications/${applicationId}/messages`;
  let messages = start;
  let marks = 0;
  const sends: string[] = [];
  const handlers: Record<string, Handler> = {
    [`GET ${path}`]: () => ({
      status: 200,
      body: { messages, unreadCount: messages.filter(({ unread }) => unread).length },
    }),
    [`POST ${path}/read`]: () => {
      marks += 1;
      messages = messages.map((item) => ({ ...item, unread: false }));
      return { status: 204 };
    },
    [`POST ${path}`]: (body) => {
      const { body: text } = body as { body: string };
      if (text.trim() === '') return problem(422, 'Enter a message.');
      sends.push(text);
      const sent = message({ side: 'applicant', body: text, sentAt: '2026-11-04T09:00:00.000Z' });
      messages = [...messages, sent];
      return { status: 201, body: sent };
    },
  };
  return { handlers, sends, marked: () => marks };
}
