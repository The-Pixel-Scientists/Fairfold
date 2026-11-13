// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Stands in for the notes and messages routes of one submission, on top of
// stubGrants() (grants-adjustments-api.ts), which answers the rest of the
// page. It keeps the notes and the thread, counts the thread's reads, and
// can refuse the next note's mention, as the real API does when a member
// lost access. All text is invented.

import type { Page } from '@playwright/test';

import { stubGrants, submission } from './grants-adjustments-api.ts';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const ada = { membershipId: uuid(11), name: 'Ada Reed' };
export const priya = { membershipId: uuid(12), name: 'Priya Shah' };
export const tom = { membershipId: uuid(13), name: 'Tom Okafor' };

export const message = (n: number, change: Record<string, unknown> = {}) => ({
  id: uuid(8100 + n),
  side: 'applicant',
  body: `Synthetic message ${String(n)}`,
  sentAt: '2026-10-22T10:00:00.000Z',
  unread: false,
  authorName: null,
  ...change,
});

export interface NotesStubOptions {
  notes?: Record<string, unknown>[];
  messages?: Record<string, unknown>[];
}

export async function stubNotesAndMessages(page: Page, options: NotesStubOptions = {}) {
  const state = {
    notes: options.notes ?? [],
    messages: options.messages ?? [],
    threadReads: 0,
    markedRead: 0,
    /** Refuse the next note's mention at this position. */
    refuseMention: null as number | null,
    posted: [] as unknown[],
  };
  await stubGrants(page);
  const base = `/api/console/submissions/${submission.id}`;

  await page.route(
    (url) =>
      url.pathname.startsWith(`${base}/`) &&
      /\/(notes|mentionable-members|messages(\/read)?)$/.test(url.pathname),
    async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname.slice(base.length);
      const key = `${request.method()} ${path}`;
      const body =
        request.postData() === null
          ? undefined
          : (request.postDataJSON() as Record<string, unknown>);
      const json = (status: number, payload?: unknown) =>
        route.fulfill({
          status,
          contentType: 'application/json',
          body: payload === undefined ? undefined : JSON.stringify(payload),
        });

      if (key === 'GET /notes') return json(200, { notes: state.notes });
      if (key === 'GET /mentionable-members') return json(200, { members: [priya, tom] });
      if (key === 'POST /notes') {
        state.posted.push(body);
        if (state.refuseMention !== null) {
          const at = state.refuseMention;
          state.refuseMention = null;
          return json(422, {
            type: 'about:blank',
            title: 'Problem',
            status: 422,
            detail: 'Check the note and try again.',
            requestId: 'req_test',
            errors: [
              {
                field: `body.mentions.${String(at)}`,
                message: 'One of the people you mentioned cannot see this application.',
              },
            ],
          });
        }
        const ids = (body?.['mentions'] as string[] | undefined) ?? [];
        const note = {
          id: uuid(8000 + state.notes.length + 1),
          body: body?.['body'],
          author: ada,
          mentions: [priya, tom].filter((member) => ids.includes(member.membershipId)),
          createdAt: '2026-10-22T11:00:00.000Z',
        };
        state.notes = [note, ...state.notes];
        return json(201, note);
      }
      if (key === 'GET /messages') {
        state.threadReads += 1;
        const unread = state.messages.filter((item) => item['unread'] === true).length;
        return json(200, { messages: state.messages, unreadCount: unread });
      }
      if (key === 'POST /messages/read') {
        state.markedRead += 1;
        state.messages = state.messages.map((item) => ({ ...item, unread: false }));
        return json(204);
      }
      if (key === 'POST /messages') {
        const sent = message(state.messages.length + 1, {
          side: 'staff',
          authorName: ada.name,
          body: body?.['body'],
        });
        state.messages = [...state.messages, sent];
        return json(201, sent);
      }
      return route.fallback();
    },
  );
  return state;
}
