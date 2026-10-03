// SPDX-License-Identifier: AGPL-3.0-or-later
//
// How an error appears in a log line: its type, a code and stack frames. The
// message is logged only for an error we wrote ourselves, a SafeError, because
// the message of any other can hold input: Node.js's JSON.parse errors quote
// it, and PostgreSQL puts the rejected value in its messages. An error from
// the database is described by its SQLSTATE code instead.

const MAX_CODE_LENGTH = 64;
const MAX_CAUSE_DEPTH = 3;

/** An error whose message we wrote, so it is safe to log and holds no input. */
export class SafeError extends Error {}

/** Whether a value is an error, including one made in another realm, which `instanceof` misses. */
export function isError(value: unknown): value is Error {
  return (Error as unknown as { isError(value: unknown): boolean }).isError(value);
}

export interface SerializedError {
  type: string;
  /** The message of a SafeError, a description of a database error, or else the type. */
  message: string;
  code?: string;
  /** For a database error, the table, column and constraint it names. */
  table?: string;
  column?: string;
  constraint?: string;
  stack?: string;
  cause?: SerializedError;
}

/** A code such as ECONNREFUSED or 23505, and nothing that could carry a value. */
const SAFE_CODE = /^[A-Za-z0-9_.-]+$/;

/** A SQLSTATE, such as 22P02. */
const SQLSTATE = /^[0-9A-Z]{5}$/;

/**
 * Describe an error without the properties it was built with. An error from
 * the driver, which has a severity and a SQLSTATE, is described by its code
 * and the names of the schema objects involved. The stack keeps its frames
 * and drops the header, which repeats the message.
 */
export function serializeError(error: unknown, depth = 0): SerializedError {
  if (typeof error === 'string') {
    return { type: 'NonError', message: `A string was thrown. Length: ${String(error.length)}.` };
  }
  if (!isError(error)) {
    return { type: 'NonError', message: 'A non-error was thrown.' };
  }

  const fields = error as Error & Record<string, unknown>;
  const { code, severity } = fields;
  const sqlstate =
    typeof severity === 'string' && typeof code === 'string' && SQLSTATE.test(code)
      ? code
      : undefined;
  const result: SerializedError = {
    type: error.name,
    message:
      sqlstate !== undefined
        ? `database error ${sqlstate}`
        : error instanceof SafeError
          ? error.message
          : error.name,
  };
  if (typeof code === 'string' && code.length <= MAX_CODE_LENGTH && SAFE_CODE.test(code)) {
    result.code = code;
  }
  if (sqlstate !== undefined) {
    for (const name of ['table', 'column', 'constraint'] as const) {
      const value = fields[name];
      if (typeof value === 'string') result[name] = value;
    }
  }
  const frames = error.stack?.split('\n').filter((line) => /^\s+at /.test(line));
  if (frames?.length) result.stack = frames.join('\n');
  if (error.cause !== undefined && depth < MAX_CAUSE_DEPTH) {
    result.cause = serializeError(error.cause, depth + 1);
  }
  return result;
}
