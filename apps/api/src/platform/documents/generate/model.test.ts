// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { boardPackFileName, documentModelSchema } from './model.ts';

const model = (blocks: unknown[], heading = 'Application 1') => ({
  title: 'Board pack',
  sections: [{ heading, blocks }],
});

describe('documentModelSchema', () => {
  it('accepts headings, text, lists and tables with their header cells', () => {
    const parsed = documentModelSchema.safeParse(
      model([
        { type: 'heading', level: 3, text: 'Summary' },
        { type: 'paragraph', text: 'Gwŷr Ŵyl <b>not markup</b> https://example.test' },
        { type: 'list', ordered: false, items: ['One'] },
        { type: 'table', header: ['Question', 'Answer'], rows: [['Aim', 'Garden']] },
      ]),
    );
    expect(parsed.success).toBe(true);
  });

  it.each([
    ['a control character', [{ type: 'paragraph', text: 'a\u0000b' }]],
    ['a bidirectional override', [{ type: 'paragraph', text: 'a\u202eb' }]],
    ['a heading above the application heading', [{ type: 'heading', level: 1, text: 'Top' }]],
    ['a ragged table', [{ type: 'table', header: ['A', 'B'], rows: [['only one']] }]],
    ['a table without a header', [{ type: 'table', header: [], rows: [] }]],
    ['an unknown block', [{ type: 'image', src: 'https://example.test/x.png' }]],
    ['an unknown key', [{ type: 'paragraph', text: 'x', href: 'https://example.test' }]],
  ])('refuses %s', (_name, blocks) => {
    expect(documentModelSchema.safeParse(model(blocks)).success).toBe(false);
  });

  it('refuses an empty heading and an author key', () => {
    expect(documentModelSchema.safeParse(model([], '')).success).toBe(false);
    expect(documentModelSchema.safeParse({ ...model([]), author: 'A member' }).success).toBe(false);
  });
});

describe('boardPackFileName', () => {
  it('is fixed words and the date', () => {
    expect(boardPackFileName(new Date('2026-12-16T10:00:00Z'))).toBe('board-pack-2026-12-16.pdf');
  });
});
