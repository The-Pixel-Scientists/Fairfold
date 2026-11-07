// SPDX-License-Identifier: AGPL-3.0-or-later

import { MockAgent } from 'undici';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { lookUpPassword, MAX_BODY_BYTES, parseRange, type BreachAnswer } from './range.ts';

// SHA-1 of "password": 5BAA6 1E4C9B93F3F0682250B6CF8331B7EE68FD8.
const PASSWORD = 'password';
const HASH = '5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8';
const PREFIX = HASH.slice(0, 5);
const SUFFIX = HASH.slice(5);
const OTHER = '0'.repeat(35);

let agent: MockAgent;

beforeEach(() => {
  agent = new MockAgent();
  agent.disableNetConnect();
});

afterEach(async () => {
  await agent.close();
});

/** The one request the client may make: the range path, padded, with the fixed user agent. */
function range() {
  return agent.get('https://api.pwnedpasswords.com').intercept({
    path: `/range/${PREFIX}`,
    method: 'GET',
    headers: { 'add-padding': 'true', 'user-agent': 'password-breach-check' },
  });
}

const look = (limitMs?: number) => lookUpPassword(PASSWORD, { dispatcher: agent, limitMs });

describe('the range lookup', () => {
  it('sends only the five-character prefix and finds a listed suffix', async () => {
    range().reply(200, `${OTHER}:3\r\n${SUFFIX}:10434004\r\n`);

    expect(await look()).toEqual({ answer: 'breached' });
    agent.assertNoPendingInterceptors();
  });

  it('answers not breached when the suffix is absent', async () => {
    range().reply(200, `${OTHER}:3\r\n`);

    expect(await look()).toEqual({ answer: 'not_breached' });
  });

  it('never counts a padding row as a match', async () => {
    range().reply(200, `${OTHER}:3\r\n${SUFFIX}:0\r\n`);

    expect(await look()).toEqual({ answer: 'not_breached' });
  });

  it.each([
    ['a redirect', 302],
    ['a missing range', 404],
    ['throttling', 429],
    ['a server error', 503],
  ])('treats %s as no answer', async (_name, status) => {
    range().reply(status, `${SUFFIX}:5\r\n`, { headers: { location: 'https://elsewhere.test/' } });

    expect(await look()).toEqual({ answer: 'no_answer', code: 'http_status' });
  });

  it.each([
    ['an empty body', ''],
    ['a lower-case suffix', `${SUFFIX.toLowerCase()}:5`],
    ['a short suffix', `${SUFFIX.slice(1)}:5`],
    ['a line without a count', SUFFIX],
    ['a stray line', `${OTHER}:3\r\n<html>`],
  ])('treats %s as no answer, never as not breached', async (_name, body) => {
    range().reply(200, body);

    expect(await look()).toEqual({ answer: 'no_answer', code: 'bad_body' });
  });

  it('treats an oversized body as no answer', async () => {
    const line = `${OTHER}:1\r\n`;
    range().reply(200, line.repeat(Math.ceil(MAX_BODY_BYTES / line.length) + 1));

    expect(await look()).toEqual({ answer: 'no_answer', code: 'bad_body' });
  });

  it('gives up at the time limit', async () => {
    range().reply(200, `${SUFFIX}:5\r\n`).delay(500);

    expect(await look(50)).toEqual({ answer: 'no_answer', code: 'timeout' });
  });

  it('reports a certificate failure as tls and any other failure as connect', async () => {
    range().replyWithError(Object.assign(new Error('x'), { code: 'CERT_HAS_EXPIRED' }));
    range().replyWithError(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }));

    expect(await look()).toEqual({ answer: 'no_answer', code: 'tls' });
    expect(await look()).toEqual({ answer: 'no_answer', code: 'connect' });
  });

  it('logs nothing and returns nothing derived from the password', async () => {
    const lines: unknown[] = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => lines.push(args));
    }
    range().reply(200, `${SUFFIX}:5\r\n`);
    range().reply(200, `${OTHER}:5\r\n`);
    range().reply(200, '').delay(500);
    const answers: BreachAnswer[] = [await look(), await look(), await look(50)];
    vi.restoreAllMocks();

    const seen = JSON.stringify([answers, lines]);
    expect(lines).toEqual([]);
    for (const secret of [PREFIX, SUFFIX, HASH, HASH.toLowerCase(), PASSWORD]) {
      expect(seen).not.toContain(secret);
    }
  });
});

describe('parseRange', () => {
  it('accepts lines ending in either form, with or without a final newline', () => {
    expect(parseRange(`${OTHER}:1\n${SUFFIX}:2`, SUFFIX)).toBe(true);
    expect(parseRange(`${OTHER}:1\r\n`, SUFFIX)).toBe(false);
  });

  it('refuses a missing body', () => {
    expect(parseRange(undefined, SUFFIX)).toBeUndefined();
  });
});
