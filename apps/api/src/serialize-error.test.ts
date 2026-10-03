// SPDX-License-Identifier: AGPL-3.0-or-later

import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { isError, SafeError, serializeError } from './serialize-error.ts';

/** An error as pg builds it: a severity, a SQLSTATE, and the values in the message and detail. */
function databaseError(message: string, code: string, fields: Record<string, unknown> = {}) {
  return Object.assign(new Error(message), { severity: 'ERROR', code, ...fields });
}

describe('isError', () => {
  it('recognises an error from another realm, which instanceof does not', () => {
    const foreign: unknown = runInNewContext('new TypeError("jane@example.com")');
    expect(foreign instanceof Error).toBe(false);
    expect(isError(foreign)).toBe(true);
    expect(isError({ message: 'not an error' })).toBe(false);
  });
});

describe('serializeError', () => {
  it('describes an ordinary error by its type, code and stack frames, not its message', () => {
    const output = serializeError(
      Object.assign(new Error('failed to connect to jane@example.com'), { code: 'ECONNREFUSED' }),
    );

    expect(output).toMatchObject({ type: 'Error', code: 'ECONNREFUSED', message: 'Error' });
    expect(output.stack).toMatch(/^\s+at /);
    expect(JSON.stringify(output)).not.toContain('jane@example.com');
  });

  it('does not log the input that a JSON.parse error quotes', () => {
    let failure: unknown;
    try {
      JSON.parse('jane@example.com');
    } catch (error) {
      failure = error;
    }

    expect((failure as Error).message).toContain('jane@example.com');
    const output = serializeError(failure);
    expect(output).toMatchObject({ type: 'SyntaxError', message: 'SyntaxError' });
    expect(JSON.stringify(output)).not.toContain('jane@example.com');
  });

  it('describes an error from another realm like any other', () => {
    const foreign: unknown = runInNewContext('new TypeError("jane@example.com")');
    const output = serializeError(foreign);
    expect(output).toMatchObject({ type: 'TypeError', message: 'TypeError' });
    expect(JSON.stringify(output)).not.toContain('jane@example.com');
  });

  it('keeps the message of an error we wrote ourselves', () => {
    class OwnError extends SafeError {}
    const output = serializeError(new OwnError('The round is closed.'));
    expect(output.message).toBe('The round is closed.');
    expect(output.stack).not.toContain('The round is closed.');
  });

  it('describes a database error by its code, because its message holds the rejected value', () => {
    const error = databaseError('invalid input syntax for type uuid: "jane@example.com"', '22P02', {
      detail: 'Key (email)=(jane@example.com) already exists.',
      where: 'SQL statement "INSERT ... jane@example.com"',
      parameters: ['jane@example.com'],
      table: 'applicant',
      column: 'id',
      constraint: 'applicant_pkey',
    });

    const output = serializeError(error);

    expect(output).toMatchObject({
      type: 'Error',
      code: '22P02',
      message: 'database error 22P02',
      table: 'applicant',
      column: 'id',
      constraint: 'applicant_pkey',
    });
    // Neither the message, nor the first line of the stack that repeats it.
    expect(JSON.stringify(output)).not.toContain('jane@example.com');
    expect(JSON.stringify(output)).not.toContain('invalid input syntax');
    expect(output.stack).toMatch(/^\s+at /);
  });

  it('describes the cause of an error the same way', () => {
    const cause = databaseError('invalid input syntax for type uuid: "jane@example.com"', '22P02');
    const output = serializeError(new SafeError('Could not load the applicant', { cause }));

    expect(output.message).toBe('Could not load the applicant');
    expect(output.cause).toMatchObject({ message: 'database error 22P02' });
    expect(JSON.stringify(output)).not.toContain('jane@example.com');
  });

  it('does not take an error for a database error without both a severity and a SQLSTATE', () => {
    expect(serializeError(Object.assign(new Error('a'), { code: '22P02' })).message).toBe('Error');
    expect(serializeError(Object.assign(new Error('b'), { severity: 'ERROR' })).message).toBe(
      'Error',
    );
    expect(
      serializeError(Object.assign(new Error('c'), { severity: 'ERROR', code: 'ECONNREFUSED' }))
        .message,
    ).toBe('Error');
  });

  it('leaves out a code that could carry a value', () => {
    for (const code of ['jo.bloggs@example.org', 'has space', 'x'.repeat(65), 42]) {
      expect(serializeError(Object.assign(new Error('failed'), { code }))).not.toHaveProperty(
        'code',
      );
    }
  });

  it('follows the cause of an error, to a limited depth', () => {
    let error = new Error('level 0');
    for (let level = 1; level < 10; level += 1)
      error = new Error(`level ${String(level)}`, { cause: error });

    let depth = 0;
    for (let next = serializeError(error).cause; next; next = next.cause) depth += 1;
    expect(depth).toBeLessThanOrEqual(3);
  });

  it('says a string was thrown and how long it was, not what it said', () => {
    expect(serializeError('jane@example.com')).toEqual({
      type: 'NonError',
      message: 'A string was thrown. Length: 16.',
    });
    expect(serializeError(new Error('outer', { cause: 'jane@example.com' })).cause).toEqual({
      type: 'NonError',
      message: 'A string was thrown. Length: 16.',
    });
  });

  it('names anything else that is not an error without describing it', () => {
    expect(serializeError({ password: 'hunter2' })).toEqual({
      type: 'NonError',
      message: 'A non-error was thrown.',
    });
  });
});
