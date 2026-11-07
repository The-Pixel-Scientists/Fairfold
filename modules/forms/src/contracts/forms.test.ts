// SPDX-License-Identifier: AGPL-3.0-or-later

import { formDefinitionSchema } from '@pixel-scientists/domain/forms';
import { messageForIssue } from '@pixel-scientists/domain/platform';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import {
  formDefinitionInputSchema,
  formSettingsInputSchema,
  publishProblems,
  retentionInputSchema,
} from './forms.ts';
import { formsMessages } from './messages.ts';

const settings = {
  title: 'Tell us about our drop-in sessions',
  description: '',
  respondents: 'both',
  opensAt: '2027-03-01T09:00:00Z',
  closesAt: '2027-04-01T17:00:00Z',
  confirmationMessage: 'Thank you. We read every response.',
};

/** Each problem's message, by where it is. */
function problems(schema: z.ZodType, value: unknown): Record<string, string> {
  const result = schema.safeParse(value);
  return Object.fromEntries(
    (result.error?.issues ?? []).map((issue) => [issue.path.join('.'), messageForIssue(issue)]),
  );
}

const definition = (fields: unknown[]) => ({
  sections: [{ id: 's_about', title: 'About the session', fields }],
});

const parse = (fields: unknown[]) => formDefinitionSchema.parse(definition(fields));

describe('form settings', () => {
  it('take a title, who may answer, UTC open and close times and messages', () => {
    expect(formSettingsInputSchema.parse({ ...settings, title: '  Feedback  ' })).toEqual({
      ...settings,
      title: 'Feedback',
    });
    expect(
      formSettingsInputSchema.safeParse({ ...settings, opensAt: null, closesAt: null }).success,
    ).toBe(true);
  });

  it('refuse unknown keys, local times, a close before the open and an empty title', () => {
    expect(formSettingsInputSchema.safeParse({ ...settings, retentionMonths: 60 }).success).toBe(
      false,
    );
    expect(
      formSettingsInputSchema.safeParse({ ...settings, opensAt: '2027-03-01T09:00:00+01:00' })
        .success,
    ).toBe(false);
    expect(problems(formSettingsInputSchema, { ...settings, closesAt: settings.opensAt })).toEqual({
      closesAt: formsMessages.closesAfterOpens,
    });
    expect(
      problems(formSettingsInputSchema, { ...settings, title: ' ', respondents: 'staff' }),
    ).toEqual({
      title: formsMessages.title,
      respondents: formsMessages.respondents,
    });
  });

  it('keep responses for 1 to 120 whole months', () => {
    for (const retentionMonths of [1, 12, 120]) {
      expect(retentionInputSchema.safeParse({ retentionMonths }).success).toBe(true);
    }
    for (const retentionMonths of [0, 121, 1.5, '12']) {
      expect(
        retentionInputSchema.safeParse({ retentionMonths }).success,
        String(retentionMonths),
      ).toBe(false);
    }
  });
});

describe('formDefinitionInputSchema', () => {
  it('checks the definition with the form engine and tidies its text', () => {
    const parsed = formDefinitionInputSchema.parse(
      definition([
        { id: 'f_rating', type: 'short_text', label: ' How was it? ', hint: 'Say why.\r\n' },
      ]),
    );
    expect(parsed.sections[0]?.fields[0]).toMatchObject({ label: 'How was it?', hint: 'Say why.' });
    const twice = definition([
      { id: 'f_rating', type: 'short_text', label: 'How was it?' },
      { id: 'f_rating', type: 'long_text', label: 'Anything else?' },
    ]);
    expect(formDefinitionInputSchema.safeParse(twice).success).toBe(false);
  });

  it('refuses hidden characters and text that is only spaces', () => {
    expect(
      problems(
        formDefinitionInputSchema,
        definition([
          { id: 'f_one', type: 'short_text', label: 'Name‮' },
          { id: 'f_two', type: 'short_text', label: 'Town', hint: '  ' },
        ]),
      ),
    ).toMatchObject({
      'sections.0.fields.0.label': formsMessages.hiddenCharacters,
      'sections.0.fields.1.hint': formsMessages.blank,
    });
  });

  it('refuses a definition over 256 KB', () => {
    const fields = Array.from({ length: 100 }, (_, i) => ({
      id: `f_q${String(i)}`,
      type: 'long_text',
      label: 'L'.repeat(500),
      hint: 'H'.repeat(1000),
    }));
    const sections = Array.from({ length: 3 }, (_, s) => ({
      id: `s_${String(s)}`,
      title: 'Questions',
      fields: fields.map((field) => ({ ...field, id: `${field.id}s${String(s)}` })),
    }));
    expect(problems(formDefinitionInputSchema, { sections })).toEqual({
      '': formsMessages.definitionTooLarge,
    });
  });
});

describe('publishProblems', () => {
  const first = parse([
    {
      id: 'f_visits',
      type: 'number',
      label: 'How many times did you come?',
      classification: 'internal',
    },
    { id: 'f_name', type: 'short_text', label: 'Your name', classification: 'personal' },
  ]);

  it('allows a first version, and one that keeps every type and classification', () => {
    expect(publishProblems([], first, 'anonymous')).toEqual([]);
    expect(publishProblems([first], first, 'both')).toEqual([]);
  });

  it('refuses, by field id, a changed type or a lowered classification against any earlier version', () => {
    const next = parse([
      {
        id: 'f_visits',
        type: 'short_text',
        label: 'How often did you come?',
        classification: 'internal',
      },
      { id: 'f_name', type: 'short_text', label: 'Your name', classification: 'internal' },
    ]);
    expect(
      publishProblems(
        [first, parse([{ id: 'f_other', type: 'date', label: 'When?' }])],
        next,
        'signed_in',
      ),
    ).toEqual([
      { field: 'f_visits', message: formsMessages.typeChanged },
      { field: 'f_name', message: formsMessages.classificationLowered },
    ]);
  });

  it('refuses a file or aggregate-only question on a form anyone can answer', () => {
    const next = parse([
      { id: 'f_photo', type: 'file', label: 'Add a photo' },
      {
        id: 'f_health',
        type: 'yes_no',
        label: 'Do you have a long-term health condition?',
        audiences: 'aggregate_only',
        classification: 'special_category',
      },
    ]);
    expect(publishProblems([], next, 'signed_in')).toEqual([]);
    for (const respondents of ['anonymous', 'both'] as const) {
      expect(publishProblems([], next, respondents)).toEqual([
        { field: 'f_photo', message: formsMessages.anonymousFile },
        { field: 'f_health', message: formsMessages.anonymousAggregate },
      ]);
    }
  });
});
