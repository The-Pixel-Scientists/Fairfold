// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { projectionAudiences, type ProjectionAudience } from '../forms/audience.ts';
import {
  applicantThreadSchema,
  noteViewSchema,
  projectMessage,
  projectNote,
  projectThread,
  staffThreadSchema,
} from './project.ts';
import type { MessageRecord, NoteRecord, ThreadRecord } from './records.ts';

const THREAD = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const MEMBER = '0b7c4a1e-5d2f-4c8e-9a3b-6f1d2e4c8a90';
const PERSON = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';
const at = (minute: number) => new Date(Date.UTC(2026, 11, 2, 10, minute));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const note: NoteRecord = {
  id: id(1),
  body: 'Budget looks light on staff costs.',
  author: { membershipId: MEMBER, name: 'Sam Patel' },
  mentions: [{ membershipId: id(9), name: null }],
  createdAt: at(0),
};

function message(n: number, side: 'applicant' | 'staff', minute: number): MessageRecord {
  return {
    id: id(n),
    threadId: THREAD,
    side,
    body: `Message ${n}`,
    authorId: side === 'staff' ? MEMBER : PERSON,
    authorName: side === 'staff' ? 'Sam Patel' : 'Should never show',
    createdAt: at(minute),
  };
}

// The applicant last read at 10:05 and staff at 10:15.
const thread: ThreadRecord = {
  messages: [
    message(1, 'applicant', 1),
    message(2, 'staff', 4),
    message(3, 'staff', 10),
    message(4, 'applicant', 12),
    message(5, 'applicant', 20),
  ],
  applicantReadAt: at(5),
  staffReadAt: at(15),
};

/** Every value in a view, flattened, to search for what must not be there. */
function values(view: unknown): string {
  return JSON.stringify(view);
}

describe('projectNote', () => {
  it('shows a note to staff, built afresh', () => {
    const smuggled = {
      ...note,
      tenantId: id(7),
      mentions: [{ membershipId: id(9), name: null, roles: [] }],
    };
    const view = projectNote(smuggled, 'staff');
    expect(noteViewSchema.parse(view)).toEqual({
      id: id(1),
      body: note.body,
      author: { membershipId: MEMBER, name: 'Sam Patel' },
      mentions: [{ membershipId: id(9), name: null }],
      createdAt: '2026-12-02T10:00:00.000Z',
    });
    expect(view?.author).not.toBe(note.author);
  });

  it.each(projectionAudiences.filter((audience) => audience !== 'staff'))(
    'shows the %s nothing',
    (audience) => {
      expect(projectNote(note, audience)).toBeNull();
    },
  );

  it('shows an unknown audience nothing', () => {
    expect(projectNote(note, 'admin' as ProjectionAudience)).toBeNull();
  });
});

describe('projectThread', () => {
  it('shows the applicant funder messages with no staff name or id, unread on their side only', () => {
    const view = projectThread(thread, 'applicant');
    expect(applicantThreadSchema.parse(view)).toEqual(view);
    expect(view.messages.map(({ side, unread }) => [side, unread])).toEqual([
      ['applicant', false],
      ['staff', false],
      ['staff', true],
      ['applicant', false],
      ['applicant', false],
    ]);
    expect(view.unreadCount).toBe(1);
    expect(values(view)).not.toMatch(/Sam Patel|Should never show|authorName/);
    expect(values(view)).not.toContain(MEMBER);
    expect(values(view)).not.toContain(PERSON);
    expect(values(view)).not.toContain(THREAD);
  });

  it("shows staff each funder message's author, and never a name on the applicant's", () => {
    const view = projectThread(thread, 'staff');
    expect(staffThreadSchema.parse(view)).toEqual(view);
    expect(view.messages.map(({ authorName, unread }) => [authorName, unread])).toEqual([
      [null, false],
      ['Sam Patel', false],
      ['Sam Patel', false],
      [null, false],
      [null, true],
    ]);
    expect(view.unreadCount).toBe(1);
    expect(values(view)).not.toContain(PERSON);
    expect(values(view)).not.toContain(MEMBER);
  });

  it('counts everything from the other side as unread when a side has never read', () => {
    const unread = { ...thread, applicantReadAt: null, staffReadAt: null };
    expect(projectThread(unread, 'applicant').unreadCount).toBe(2);
    expect(projectThread(unread, 'staff').unreadCount).toBe(3);
  });

  it("reads each side against its own time, so one side's read leaves the other's count", () => {
    const staffRead = { ...thread, staffReadAt: at(30) };
    expect(projectThread(staffRead, 'staff').unreadCount).toBe(0);
    expect(projectThread(staffRead, 'applicant').unreadCount).toBe(1);
  });

  it('builds each message afresh, so an unknown property never survives', () => {
    const smuggled = { ...message(6, 'staff', 40), tenantId: id(7), decision: 'awarded' };
    for (const audience of ['applicant', 'staff'] as const) {
      const view = projectMessage(smuggled, audience, null);
      expect(Object.keys(view ?? {}).sort()).toEqual(
        audience === 'staff'
          ? ['authorName', 'body', 'id', 'sentAt', 'side', 'unread']
          : ['body', 'id', 'sentAt', 'side', 'unread'],
      );
    }
  });

  it.each(['reviewer', 'blind_reviewer', 'respondent', 'admin'] as ProjectionAudience[])(
    'shows the %s nothing',
    (audience) => {
      expect(projectThread(thread, audience)).toBeNull();
      expect(projectMessage(message(2, 'staff', 4), audience, null)).toBeNull();
    },
  );

  it('covers every projection audience', () => {
    const seen = projectionAudiences.map((audience) => [
      audience,
      projectThread(thread, audience) !== null,
      projectNote(note, audience) !== null,
    ]);
    expect(seen).toEqual([
      ['applicant', true, false],
      ['staff', true, true],
      ['reviewer', false, false],
      ['blind_reviewer', false, false],
      ['respondent', false, false],
    ]);
  });
});
