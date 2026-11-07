// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { messageForIssue } from '../platform/messages.ts';
import {
  checkMentions,
  MAX_MENTIONS,
  MAX_MESSAGE_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_TAG_LABEL_LENGTH,
  mentionsSchema,
  messageBodySchema,
  noteBodySchema,
  tagLabelSchema,
} from './body.ts';
import { notesMessages } from './messages.ts';

const ch = (...codes: number[]) => String.fromCodePoint(...codes);
const A = '0b7c4a1e-5d2f-4c8e-9a3b-6f1d2e4c8a90';
const B = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';
const C = '9e8d7c6b-5a49-4382-b170-6f5e4d3c2b1a';

function refusal(
  schema: { safeParse(value: unknown): { error?: { issues: object[] } } },
  value: unknown,
) {
  return schema.safeParse(value).error?.issues.map(messageForIssue);
}

describe('note and message bodies', () => {
  it('are trimmed plain text, with line breaks kept as \\n', () => {
    expect(noteBodySchema.parse('  Called the treasurer.\r\nAll fine. ')).toBe(
      'Called the treasurer.\nAll fine.',
    );
    expect(
      messageBodySchema.parse(`Thanks ${ch(0x1f469, 0x200d, 0x1f4bb)}, 3 < 5 and a <-> b`),
    ).toBe(`Thanks ${ch(0x1f469, 0x200d, 0x1f4bb)}, 3 < 5 and a <-> b`);
  });

  it('refuse blank text, counting whitespace and zero-width characters as blank', () => {
    for (const blank of ['', '   ', '\n\t', ch(0x200b, 0x200c), ` ${ch(0xfeff, 0x2060, 0xad)} `]) {
      expect(refusal(noteBodySchema, blank)).toEqual([notesMessages.enterNote]);
      expect(refusal(messageBodySchema, blank)).toEqual([notesMessages.enterMessage]);
    }
  });

  it('refuse text over the limit once trimmed', () => {
    expect([MAX_NOTE_LENGTH, MAX_MESSAGE_LENGTH]).toEqual([5000, 2000]);
    expect(noteBodySchema.safeParse(`${'a'.repeat(MAX_NOTE_LENGTH)}  `).success).toBe(true);
    expect(noteBodySchema.safeParse('a'.repeat(MAX_NOTE_LENGTH + 1)).success).toBe(false);
    expect(messageBodySchema.safeParse('a'.repeat(MAX_MESSAGE_LENGTH + 1)).success).toBe(false);
  });

  it('refuse hidden and direction characters', () => {
    for (const code of [0x00, 0x07, 0x1b, 0x7f, 0x2028, 0x2029, 0x200e, 0x202e, 0x2066, 0xd800]) {
      expect(refusal(messageBodySchema, `Hello ${ch(code)}there`), code.toString(16)).toContain(
        notesMessages.hiddenCharacters,
      );
    }
  });

  it('refuse HTML, without repeating it', () => {
    for (const markup of [
      '<b>Hi</b>',
      'see <img src=x onerror=alert(1)>',
      'a <!-- b -->',
      'end</p>',
    ]) {
      expect(refusal(noteBodySchema, markup)).toEqual([notesMessages.markup]);
    }
  });

  it('refuse anything but a string', () => {
    for (const value of [undefined, null, 1, ['text'], { body: 'text' }]) {
      expect(noteBodySchema.safeParse(value).success).toBe(false);
    }
  });
});

describe('mentions', () => {
  it('are a capped list of membership ids, each once', () => {
    expect(MAX_MENTIONS).toBe(10);
    expect(mentionsSchema.parse([A, B])).toEqual([A, B]);
    expect(refusal(mentionsSchema, [A, A])).toEqual([notesMessages.mentionOnce]);
    expect(mentionsSchema.safeParse(['@Sam'])).toMatchObject({ success: false });
    const many = Array.from(
      { length: MAX_MENTIONS + 1 },
      (_, i) => `${String(i).padStart(8, '0')}-5d2f-4c8e-9a3b-6f1d2e4c8a90`,
    );
    expect(mentionsSchema.safeParse(many).success).toBe(false);
  });

  it('pass checkMentions() only if every id is a member allowed to see the record', () => {
    const allowed = new Set([A, B]);
    expect(checkMentions([], allowed)).toEqual([]);
    expect(checkMentions([B, A], allowed)).toEqual([]);
    expect(checkMentions([A, C, B, C], allowed)).toEqual([
      { field: 'body.mentions.1', message: notesMessages.mentionNotAllowed },
      { field: 'body.mentions.3', message: notesMessages.mentionNotAllowed },
    ]);
    expect(checkMentions([A], new Set())).toHaveLength(1);
  });
});

describe('tag labels', () => {
  it('are one trimmed line of up to 40 characters', () => {
    expect(MAX_TAG_LABEL_LENGTH).toBe(40);
    expect(tagLabelSchema.parse(' Follow up ')).toBe('Follow up');
    expect(refusal(tagLabelSchema, '  ')).toEqual([notesMessages.enterLabel]);
    expect(refusal(tagLabelSchema, 'Two\nlines')).toEqual([notesMessages.hiddenCharactersLabel]);
    expect(refusal(tagLabelSchema, `Hid${ch(0x200b)}den`)).toEqual([
      notesMessages.hiddenCharactersLabel,
    ]);
    expect(tagLabelSchema.safeParse('a'.repeat(MAX_TAG_LABEL_LENGTH + 1)).success).toBe(false);
  });
});

describe('messages', () => {
  it('each say what is wrong and how to fix it, and name no one', () => {
    for (const text of Object.values(notesMessages)) {
      expect(text).toMatch(/^[A-Z][^.]*\.( [A-Z][^.]*\.)*$/);
      expect(text).not.toMatch(/sorry/i);
    }
  });
});
