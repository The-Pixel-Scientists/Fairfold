// SPDX-License-Identifier: AGPL-3.0-or-later

import { formMessages } from '@pixel-scientists/domain/forms';
import { messageForIssue } from '@pixel-scientists/domain/platform';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { programmeMessages } from '../programme/messages.ts';
import {
  definitionBytes,
  FORM_DEFINITION_MAX_BYTES,
  formDraftInputSchema,
  formFileSchema,
  formVersionMessages,
} from './inputs.ts';

const definition = {
  sections: [
    {
      id: 's_about',
      title: 'About your organisation',
      fields: [
        { id: 'f_orgname', type: 'short_text', label: 'Organisation name', required: true },
        { id: 'f_charity', type: 'yes_no', label: 'Is your organisation a registered charity?' },
      ],
    },
  ],
};

/** A form of long text questions with the longest label and hint, about 1.6 KB each. */
function formOf(questions: number) {
  const sections = Array.from({ length: Math.ceil(questions / 100) }, (_, s) => ({
    id: `s_${String(s)}`,
    title: `Section ${String(s + 1)}`,
    fields: Array.from({ length: Math.min(100, questions - s * 100) }, (_, f) => ({
      id: `f_${String(s * 100 + f)}`,
      type: 'long_text',
      label: 'L'.repeat(500),
      hint: 'H'.repeat(1000),
    })),
  }));
  return { sections };
}

/** Each problem's message, by where it is. */
function problems(schema: z.ZodType, value: unknown): Record<string, string> {
  const result = schema.safeParse(value);
  return Object.fromEntries(
    (result.error?.issues ?? []).map((issue) => [issue.path.join('.'), messageForIssue(issue)]),
  );
}

describe('saving a draft', () => {
  it('takes a whole definition and writes out its defaults', () => {
    const saved = formDraftInputSchema.parse({ definition }).definition;
    expect(saved.sections[0]?.fields[1]).toEqual({
      id: 'f_charity',
      type: 'yes_no',
      label: 'Is your organisation a registered charity?',
      required: false,
      identity: false,
      audiences: ['applicant', 'staff', 'reviewer'],
      conditions: [],
    });
  });

  it('refuses keys it does not name, at every level', () => {
    for (const input of [
      { definition, version: 2 },
      { definition: { ...definition, title: 'Form' } },
      { definition: { sections: [{ ...definition.sections[0], colour: 'blue' }] } },
    ]) {
      expect(formDraftInputSchema.safeParse(input).success, JSON.stringify(input)).toBe(false);
    }
    expect(formDraftInputSchema.safeParse({}).success).toBe(false);
  });

  it("answers the form engine's problems by where they are", () => {
    const fields = [definition.sections[0]?.fields[0], definition.sections[0]?.fields[0]];
    expect(
      problems(formDraftInputSchema, {
        definition: { sections: [{ ...definition.sections[0], fields }] },
      }),
    ).toEqual({ 'definition.sections.0.fields.1.id': formMessages.idUsedTwice });
  });
});

/** A definition with every kind of text, each as given. */
function withText(line: string, text: string) {
  return {
    sections: [
      {
        id: 's_about',
        title: line,
        introduction: text,
        fields: [
          { id: 'f_intro', type: 'content', body: text },
          {
            id: 'f_kind',
            type: 'single_choice',
            label: line,
            hint: text,
            required: true,
            options: [
              { value: 'yes', label: line },
              { value: 'no', label: 'No' },
            ],
            eligibility: { stopValues: ['no'], explanation: text },
          },
          {
            id: 'f_costs',
            type: 'table',
            label: 'Costs',
            rowNoun: line,
            columns: [{ id: 'c_item', type: 'short_text', label: line }],
          },
        ],
      },
    ],
  };
}

const LINE_PATHS = [
  'sections.0.title',
  'sections.0.fields.1.label',
  'sections.0.fields.1.options.0.label',
  'sections.0.fields.2.rowNoun',
  'sections.0.fields.2.columns.0.label',
];
const TEXT_PATHS = [
  'sections.0.introduction',
  'sections.0.fields.0.body',
  'sections.0.fields.1.hint',
  'sections.0.fields.1.eligibility.explanation',
];

/** The same message at each path, under `definition`. */
function at(paths: string[], message: string): Record<string, string> {
  return Object.fromEntries(paths.map((path) => [`definition.${path}`, message]));
}

describe('text in a definition', () => {
  const file = (definition: unknown) => ({
    format: 'form-definition',
    formatVersion: 1,
    definition,
  });

  it('is trimmed, with line breaks kept in text that runs over several lines', () => {
    const { definition: saved } = formDraftInputSchema.parse({
      definition: withText('  Costs  ', ' First line.\r\nSecond line.\n '),
    });
    const [section] = saved.sections;
    expect(section?.title).toBe('Costs');
    expect(section?.introduction).toBe('First line.\nSecond line.');
    expect(section?.fields[1]).toMatchObject({
      label: 'Costs',
      hint: 'First line.\nSecond line.',
      options: [
        { value: 'yes', label: 'Costs' },
        { value: 'no', label: 'No' },
      ],
    });
    const imported = formFileSchema.parse(file(withText(' Costs', 'Text ')));
    expect(imported.definition.sections[0]?.title).toBe('Costs');
  });

  it.each([
    ['NUL', 'a\u0000b'],
    ['a right-to-left override', '\u202eevil'],
    ['a zero-width space', 'zero\u200bwidth'],
    ['a line separator', 'line\u2028sep'],
    ['a line break', 'two\nlines'],
  ])('refuses %s in one-line text, saved or imported', (_, line) => {
    const expected = at(LINE_PATHS, programmeMessages.hiddenCharacters);
    expect(problems(formDraftInputSchema, { definition: withText(line, 'Text') })).toEqual(
      expected,
    );
    expect(problems(formFileSchema, file(withText(line, 'Text')))).toEqual(expected);
  });

  it.each([
    ['NUL', 'a\u0000b'],
    ['a right-to-left override', '\u202eevil'],
    ['a zero-width space', 'zero\u200bwidth'],
    ['a paragraph separator', 'one\u2029two'],
  ])('refuses %s in text over several lines, saved or imported', (_, text) => {
    const expected = at(TEXT_PATHS, programmeMessages.hiddenCharactersText);
    expect(problems(formDraftInputSchema, { definition: withText('Costs', text) })).toEqual(
      expected,
    );
    expect(problems(formFileSchema, file(withText('Costs', text)))).toEqual(expected);
  });

  it('refuses text that is only spaces, saved or imported', () => {
    const expected = at([...LINE_PATHS, ...TEXT_PATHS], formVersionMessages.blank);
    expect(problems(formDraftInputSchema, { definition: withText('   ', ' \n ') })).toEqual(
      expected,
    );
    expect(problems(formFileSchema, file(withText('   ', ' \n ')))).toEqual(expected);
  });
});

describe('the definition size limit', () => {
  it('is 256 KB of compact JSON in UTF-8', () => {
    expect(FORM_DEFINITION_MAX_BYTES).toBe(262_144);
    expect(definitionBytes({ label: '£5' })).toBe(JSON.stringify({ label: '£5' }).length + 1);
  });

  it('allows a definition up to the limit, as parsed with its defaults', () => {
    const { definition: saved } = formDraftInputSchema.parse({ definition: formOf(140) });
    expect(definitionBytes(saved)).toBeLessThan(FORM_DEFINITION_MAX_BYTES);
  });

  it('refuses a larger one, saying how to fix it', () => {
    expect(definitionBytes(formOf(170))).toBeGreaterThan(FORM_DEFINITION_MAX_BYTES);
    expect(problems(formDraftInputSchema, { definition: formOf(170) })).toEqual({
      definition: formVersionMessages.tooLarge,
    });
  });
});

describe('a form file', () => {
  const file = { format: 'form-definition', formatVersion: 1, definition };

  it('holds a definition the form engine accepts', () => {
    expect(formFileSchema.parse(file).definition.sections[0]?.fields).toHaveLength(2);
  });

  it('refuses another format or version, a missing part, or an extra one', () => {
    for (const input of [
      { ...file, format: 'form' },
      { ...file, formatVersion: 2 },
      { format: 'form-definition', formatVersion: 1 },
      { ...file, exportedAt: '2027-02-02T09:00:00Z' },
      { ...file, definition: { sections: [] } },
      { ...file, definition: formOf(170) },
    ]) {
      expect(formFileSchema.safeParse(input).success, JSON.stringify(input).slice(0, 80)).toBe(
        false,
      );
    }
  });
});
