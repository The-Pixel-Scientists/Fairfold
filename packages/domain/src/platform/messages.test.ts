// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { catalogueParams, fieldForIssue, messageForIssue, messages } from './messages.ts';

function firstIssue(schema: z.ZodType, value: unknown): z.core.$ZodIssue {
  const result = schema.safeParse(value);
  if (result.success) throw new Error('Expected the value to fail.');
  const [issue] = result.error.issues;
  if (issue === undefined) throw new Error('Expected an issue.');
  return issue;
}

describe('messageForIssue', () => {
  it('words each kind of Zod issue', () => {
    const cases: [z.ZodType, unknown, string][] = [
      [z.string(), 4, 'Enter text.'],
      [z.int(), 1.5, 'Enter a whole number.'],
      [z.string().min(3), 'ab', 'Enter at least 3 characters.'],
      [z.string().max(1), 'ab', 'Enter no more than 1 character.'],
      [z.array(z.string()).min(2), [], 'Add at least 2 items.'],
      [z.number().gt(5), 5, 'Enter more than 5.'],
      [z.number().max(10), 11, 'Enter 10 or less.'],
      [z.email(), 'nope', 'Enter a valid email address.'],
      [z.uuid(), 'nope', 'This id is not valid.'],
      [z.enum(['a', 'b']), 'c', 'Choose one of the allowed values.'],
      [z.strictObject({}), { extra: 1 }, 'This field is not accepted.'],
    ];
    for (const [schema, value, expected] of cases) {
      expect(messageForIssue(firstIssue(schema, value))).toBe(expected);
    }
  });

  it('uses a schema message from the catalogue, whatever the kind of issue', () => {
    const schema = z.string().min(12, { error: messages.passwordTooShort });
    expect(messageForIssue(firstIssue(schema, 'short'))).toBe(messages.passwordTooShort);
  });

  it('never uses a message from outside the catalogue', () => {
    const schema = z.string().min(12, { error: 'You typed hunter2' });
    expect(messageForIssue(firstIssue(schema, 'hunter2'))).toBe('Enter at least 12 characters.');
    const echo = z
      .string()
      .refine((v) => v === 'ok', { error: (issue) => `Not ${String(issue.input)}` });
    expect(messageForIssue(firstIssue(echo, 'hunter2'))).toBe(messages.notValid);
  });

  it('uses a custom message marked as written from the catalogue', () => {
    const marked = z.string().superRefine((_value, context) => {
      context.addIssue({
        code: 'custom',
        message: 'Choose a later date.',
        params: catalogueParams,
      });
    });
    expect(messageForIssue(firstIssue(marked, 'x'))).toBe('Choose a later date.');
    const fixed = z.string().refine(() => false, { error: messages.slugReserved });
    expect(messageForIssue(firstIssue(fixed, 'x'))).toBe(messages.slugReserved);
  });

  it('never repeats a submitted value or key', () => {
    const message = messageForIssue(firstIssue(z.strictObject({}), { 'secret-key': 1 }));
    expect(message).not.toContain('secret-key');
    expect(messageForIssue(firstIssue(z.enum(['a']), 'secret'))).not.toContain('secret');
  });

  it('reads the API entry shape too, and falls back for anything unknown', () => {
    expect(messageForIssue({ code: 'too_small', origin: 'string', minimum: 2 } as object)).toBe(
      'Enter at least 2 characters.',
    );
    expect(messageForIssue({ code: 'something_new' })).toBe(messages.notValid);
    expect(messageForIssue({})).toBe(messages.notValid);
  });

  it('cuts a long custom message', () => {
    const issue = { code: 'custom', message: 'x'.repeat(500), params: catalogueParams };
    expect(messageForIssue(issue)).toHaveLength(200);
  });
});

describe('fieldForIssue', () => {
  it('names the field by its location and path', () => {
    const issue = firstIssue(z.strictObject({ answers: z.array(z.string()) }), { answers: [1] });
    expect(fieldForIssue('body', issue)).toBe('body.answers.0');
  });

  it('leaves out an invalid record key, which the sender chose', () => {
    const answers = z.record(z.string().regex(/^f_[a-z0-9]+$/), z.string());
    const issue = firstIssue(z.strictObject({ answers }), { answers: { '<b>hunter2</b>': 'x' } });
    expect(issue.code).toBe('invalid_key');
    expect(fieldForIssue('body', issue)).toBe('body.answers');
  });

  it('replaces any segment that is not a plain field id or position', () => {
    const path = ['answers', 'name with spaces', 'x'.repeat(65), Symbol('s'), 'f_ok', 3];
    expect(fieldForIssue('body', { code: 'invalid_type', path })).toBe('body.answers.*.*.*.f_ok.3');
  });

  it('never names a field after a prototype key', () => {
    const path = ['__proto__', 'constructor', 'prototype', 'title'];
    expect(fieldForIssue('body', { code: 'invalid_type', path })).toBe('body.*.*.*.title');
  });
});
