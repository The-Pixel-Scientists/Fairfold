// SPDX-License-Identifier: AGPL-3.0-or-later

import { validatorCompiler } from 'fastify-type-provider-zod';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { fieldProblems, type FieldProblem, type ValidationEntry } from './validation-problems.ts';

/**
 * Validate `data` the way the server does, with the Zod validator compiler,
 * and return the field problems that follow.
 */
function problemsFor(schema: z.ZodType, data: unknown, httpPart = 'body'): FieldProblem[] {
  const validate = validatorCompiler({ schema, method: 'POST', url: '/things', httpPart });
  const result = validate(data) as { error?: ValidationEntry[] };
  if (!result.error) throw new Error('Expected validation to fail.');
  return fieldProblems(result.error, httpPart);
}

function messagesFor(schema: z.ZodType, data: unknown): string[] {
  return problemsFor(schema, data).map((problem) => problem.message);
}

describe('fieldProblems', () => {
  it('names the part of the request, and the path inside it', () => {
    const schema = z.strictObject({ page: z.number().min(1) });
    expect(problemsFor(schema, { page: 0 }, 'body')).toEqual([
      { field: 'body.page', message: 'Enter 1 or more.' },
    ]);
    expect(problemsFor(schema, { page: 0 }, 'querystring')).toEqual([
      { field: 'query.page', message: 'Enter 1 or more.' },
    ]);
    expect(problemsFor(schema, { page: 0 }, 'params')[0]?.field).toBe('params.page');
    expect(problemsFor(schema, { page: 0 }, 'headers')[0]?.field).toBe('headers.page');
    expect(problemsFor(schema, { page: 0 }, 'something-else')[0]?.field).toBe('request.page');
  });

  it('names a nested field by its keys and list positions', () => {
    const schema = z.strictObject({
      answers: z.record(z.string(), z.string().min(2)),
      tags: z.array(z.string()),
    });
    expect(problemsFor(schema, { answers: { f_0a1b: 'x' }, tags: ['ok', 5] })).toEqual([
      { field: 'body.answers.f_0a1b', message: 'Enter at least 2 characters.' },
      { field: 'body.tags.1', message: 'Enter text.' },
    ]);
  });

  it('says what is wrong with the kind of value', () => {
    expect(messagesFor(z.object({ a: z.string() }), {})).toEqual(['Enter text.']);
    expect(messagesFor(z.object({ a: z.number() }), { a: 'x' })).toEqual(['Enter a number.']);
    expect(messagesFor(z.object({ a: z.boolean() }), { a: 'x' })).toEqual([
      'Choose true or false.',
    ]);
    expect(messagesFor(z.object({ a: z.array(z.string()) }), { a: 'x' })).toEqual(['Send a list.']);
    expect(messagesFor(z.object({ a: z.object({}) }), { a: 'x' })).toEqual(['Send an object.']);
  });

  it('says how long or large a value may be, in the singular or plural', () => {
    expect(messagesFor(z.object({ a: z.string().min(1) }), { a: '' })).toEqual([
      'Enter at least 1 character.',
    ]);
    expect(messagesFor(z.object({ a: z.string().min(3) }), { a: 'ab' })).toEqual([
      'Enter at least 3 characters.',
    ]);
    expect(messagesFor(z.object({ a: z.string().max(2) }), { a: 'abc' })).toEqual([
      'Enter no more than 2 characters.',
    ]);
    expect(messagesFor(z.object({ a: z.array(z.string()).min(1) }), { a: [] })).toEqual([
      'Add at least 1 item.',
    ]);
    expect(
      messagesFor(z.object({ a: z.array(z.string()).max(2) }), { a: ['a', 'b', 'c'] }),
    ).toEqual(['Add no more than 2 items.']);
    expect(messagesFor(z.object({ a: z.number().min(5) }), { a: 1 })).toEqual(['Enter 5 or more.']);
    expect(messagesFor(z.object({ a: z.number().max(5) }), { a: 9 })).toEqual(['Enter 5 or less.']);
    expect(messagesFor(z.object({ a: z.number().gt(5) }), { a: 1 })).toEqual([
      'Enter more than 5.',
    ]);
    expect(messagesFor(z.object({ a: z.number().lt(5) }), { a: 9 })).toEqual([
      'Enter less than 5.',
    ]);
  });

  it('says what format a value should be in', () => {
    expect(messagesFor(z.object({ a: z.email() }), { a: 'nope' })).toEqual([
      'Enter a valid email address.',
    ]);
    expect(messagesFor(z.object({ a: z.url() }), { a: 'nope' })).toEqual([
      'Enter a valid web address.',
    ]);
    expect(messagesFor(z.object({ a: z.uuid() }), { a: 'nope' })).toEqual([
      'This id is not valid.',
    ]);
    expect(messagesFor(z.object({ a: z.iso.date() }), { a: 'nope' })).toEqual([
      'Enter a valid date.',
    ]);
    expect(messagesFor(z.object({ a: z.string().regex(/^[a-z]+$/) }), { a: '1' })).toEqual([
      'This value is not in the expected format.',
    ]);
  });

  it('does not list the allowed values of a choice', () => {
    expect(messagesFor(z.object({ a: z.enum(['open', 'closed']) }), { a: 'draft' })).toEqual([
      'Choose one of the allowed values.',
    ]);
  });

  it('passes on the message of a custom check written in the domain package', () => {
    const schema = z.object({
      closes: z
        .string()
        .refine((value) => value > '2027-04-01', 'Enter a date after 1 April 2027.'),
    });
    expect(messagesFor(schema, { closes: '2026-01-01' })).toEqual([
      'Enter a date after 1 April 2027.',
    ]);
  });

  it('uses a general message for any other kind of failure', () => {
    expect(
      fieldProblems(
        [{ keyword: 'something_new', instancePath: '/a', message: 'Raw text' }],
        'body',
      ),
    ).toEqual([{ field: 'body.a', message: 'This value is not valid.' }]);
    expect(fieldProblems([{ keyword: 'custom', instancePath: '/a' }], 'body')).toEqual([
      { field: 'body.a', message: 'This value is not valid.' },
    ]);
  });

  it('names an unknown key if it looks like a field id, and hides it if it does not', () => {
    const schema = z.strictObject({ title: z.string() });
    expect(
      problemsFor(schema, {
        title: 'ok',
        extra: 1,
        f_0a1b: 2,
        'x<script>alert(1)</script>': 3,
        'jo.bloggs@example.org': 4,
        ['k'.repeat(70)]: 5,
      }),
    ).toEqual([
      { field: 'body.extra', message: 'This field is not accepted.' },
      { field: 'body.f_0a1b', message: 'This field is not accepted.' },
      { field: 'body.*', message: 'This field is not accepted.' },
      { field: 'body.*', message: 'This field is not accepted.' },
      { field: 'body.*', message: 'This field is not accepted.' },
    ]);
  });

  it('hides a record key that does not look like a field id', () => {
    const schema = z.object({ answers: z.record(z.string(), z.string().min(2)) });
    expect(problemsFor(schema, { answers: { 'jo.bloggs@example.org': 'x' } })).toEqual([
      { field: 'body.answers.*', message: 'Enter at least 2 characters.' },
    ]);
  });

  it('never repeats what was sent', () => {
    const schema = z.strictObject({
      name: z.string().min(50),
      email: z.email(),
      amount: z.number(),
      choice: z.enum(['a', 'b']),
      list: z.array(z.string().min(5)),
    });
    const problems = problemsFor(schema, {
      name: 'Jo Bloggs',
      email: 'jo.bloggs-at-example.org',
      amount: 'twelve thousand',
      choice: 'secret-choice',
      list: ['tiny'],
    });
    const text = JSON.stringify(problems);
    for (const sent of ['Bloggs', 'twelve', 'secret-choice', 'tiny']) {
      expect(text).not.toContain(sent);
    }
    expect(problems.length).toBeGreaterThan(3);
  });

  it('lists at most 20 problems', () => {
    const entries = Array.from({ length: 50 }, (_unused, index) => ({
      keyword: 'invalid_type',
      instancePath: `/field_${String(index)}`,
      params: { expected: 'string' },
    }));
    expect(fieldProblems(entries, 'body')).toHaveLength(20);

    const keys = Array.from({ length: 50 }, (_unused, index) => `key_${String(index)}`);
    expect(
      fieldProblems([{ keyword: 'unrecognized_keys', instancePath: '', params: { keys } }], 'body'),
    ).toHaveLength(20);
  });

  it('copes with entries that are missing parts', () => {
    expect(fieldProblems([{}], undefined)).toEqual([
      { field: 'request', message: 'This value is not valid.' },
    ]);
  });
});
