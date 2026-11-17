// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Test helpers: the API's answers for one application's messages, built through
// the contracts, keeping the thread as the real API does. Not part of the app.

import { applicantMessageSchema, applicantThreadSchema } from '@pixel-scientists/domain/notes';
import type { ApplicantMessage } from '@pixel-scientists/domain/notes';

import { problem } from './api.ts';
import type { Reply } from './api.ts';
import { created, ok } from './party.ts';

let counter = 0;

export function message(overrides: Partial<ApplicantMessage> = {}): ApplicantMessage {
  counter += 1;
  return applicantMessageSchema.parse({
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    side: 'staff',
    body: 'Hello.',
    sentAt: '2026-11-03T10:15:00.000Z',
    unread: false,
    ...overrides,
  });
}

export interface MessageServer {
  messages: ApplicantMessage[];
  /** The body of each message it accepted. */
  sends: string[];
  marked: () => number;
  handlers: Record<string, (body: unknown) => Reply>;
}

/** The thread routes of one application, starting with `start`. */
export function messageServer(applicationId: string, ...start: ApplicantMessage[]): MessageServer {
  const base = `/portal/applications/${applicationId}/messages`;
  let marks = 0;
  const server: MessageServer = {
    messages: start,
    sends: [],
    marked: () => marks,
    handlers: {},
  };
  server.handlers = {
    [`GET ${base}`]: () =>
      ok(
        applicantThreadSchema.parse({
          messages: server.messages,
          unreadCount: server.messages.filter(({ unread }) => unread).length,
        }),
      ),
    [`POST ${base}/read`]: () => {
      marks += 1;
      server.messages = server.messages.map((item) => ({ ...item, unread: false }));
      return { status: 204 };
    },
    [`POST ${base}`]: (body) => {
      const { body: text } = body as { body: string };
      server.sends.push(text);
      const sent = message({ side: 'applicant', body: text, sentAt: '2026-11-04T09:00:00.000Z' });
      server.messages = [...server.messages, sent];
      return created(sent);
    },
  };
  return server;
}

export const noThread = (applicationId: string): Record<string, Reply> => ({
  [`GET /portal/applications/${applicationId}/messages`]: problem(404, 'Not found.'),
});
