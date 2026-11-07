// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The breached-password lookup (ADR 0010, "Sign-in limits and passwords"):
// the range API of the breached-password service, reached only through its
// pinned client. Only the first five hex characters of the password's SHA-1
// leave the process; the other 35 are compared here against the suffixes in
// the padded answer. Anything but a well-formed 200 answer within the limit
// is "no answer", never "not breached". Nothing here logs, and a failure is
// returned as a code that holds nothing of the password or the request.

import { createHash } from 'node:crypto';

import { request, type Dispatcher } from 'undici';

import { HIBP, pinnedHttpsDispatcher } from '../../outbound/pinned.ts';

export type NoAnswerCode = 'timeout' | 'http_status' | 'bad_body' | 'tls' | 'connect';

export type BreachAnswer =
  | { readonly answer: 'breached' | 'not_breached' }
  | { readonly answer: 'no_answer'; readonly code: NoAnswerCode };

/** One limit for connecting, the headers and the body. */
export const LIMIT_MS = 3_000;

/** A padded answer is about 800 to 1,000 lines of about 40 bytes. */
export const MAX_BODY_BYTES = 128 * 1024;

const USER_AGENT = 'password-breach-check';
const LINE = /^([0-9A-F]{35}):(\d{1,10})$/;
const TLS_CODE = /^(ERR_TLS_|ERR_SSL_|CERT_|UNABLE_TO_|DEPTH_ZERO_|SELF_SIGNED_|HOSTNAME_)/;
const TIMEOUT_CODE = /^UND_ERR_(CONNECT|HEADERS|BODY)_TIMEOUT$/;

export interface RangeOptions {
  /** Tests only: a local fake in place of the pinned client. */
  readonly dispatcher?: Dispatcher;
  readonly limitMs?: number;
}

let pinned: Dispatcher | undefined;

/** Whether the password is in the service's breach corpus, or a code if it did not answer. */
export async function lookUpPassword(
  password: string,
  options: RangeOptions = {},
): Promise<BreachAnswer> {
  const hash = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  const signal = AbortSignal.timeout(options.limitMs ?? LIMIT_MS);
  try {
    const { statusCode, body } = await request(`https://${HIBP.host}/range/${hash.slice(0, 5)}`, {
      method: 'GET',
      headers: { 'add-padding': 'true', 'user-agent': USER_AGENT },
      dispatcher: options.dispatcher ?? (pinned ??= pinnedHttpsDispatcher(HIBP)),
      signal,
    });
    if (statusCode !== 200) {
      body.destroy();
      return noAnswer('http_status');
    }
    const found = parseRange(await readCapped(body), hash.slice(5));
    return found === undefined
      ? noAnswer('bad_body')
      : { answer: found ? 'breached' : 'not_breached' };
  } catch (error) {
    return noAnswer(signal.aborted ? 'timeout' : failureCode(error));
  }
}

/**
 * Whether `suffix` is listed with a count above zero (padding rows have a
 * count of zero). Undefined for an empty body or any line that is not
 * `SUFFIX:COUNT` in upper-case hex, so a damaged answer never reads as clear.
 */
export function parseRange(text: string | undefined, suffix: string): boolean | undefined {
  if (text === undefined) return undefined;
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  if (lines.length === 0) return undefined;
  let found = false;
  for (const line of lines) {
    const [, listed, count] = LINE.exec(line) ?? [];
    if (listed === undefined) return undefined;
    if (listed === suffix && Number(count) > 0) found = true;
  }
  return found;
}

async function readCapped(body: AsyncIterable<Buffer>): Promise<string | undefined> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of body) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) return undefined;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function failureCode(error: unknown): NoAnswerCode {
  const { code, cause } = (error ?? {}) as { code?: unknown; cause?: { code?: unknown } };
  const found = typeof code === 'string' ? code : cause?.code;
  if (typeof found !== 'string') return 'connect';
  if (TIMEOUT_CODE.test(found)) return 'timeout';
  return TLS_CODE.test(found) ? 'tls' : 'connect';
}

const noAnswer = (code: NoAnswerCode): BreachAnswer => ({ answer: 'no_answer', code });
