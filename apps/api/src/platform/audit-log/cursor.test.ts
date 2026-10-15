// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { ApiError } from '../../problems.ts';
import { decodeCursor, encodeCursor } from './cursor.ts';

const cursor = { occurredAt: '2026-10-07T09:30:00.123456Z', id: randomUUID() };
const encode = (text: string): string => Buffer.from(text).toString('base64url');

describe('the audit log cursor', () => {
  it('reads back what it wrote, keeping the microseconds', () => {
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('is URL safe and fits the contract', () => {
    expect(encodeCursor(cursor)).toMatch(/^[A-Za-z0-9_-]{1,200}$/);
  });

  it.each([
    ['not a cursor', 'abc'],
    ['no id', encode('2026-10-07T09:30:00.123456Z|')],
    ['an id that is not a uuid', encode(`2026-10-07T09:30:00.123456Z|${'x'.repeat(36)}`)],
    ['milliseconds only', encode(`2026-10-07T09:30:00.123Z|${cursor.id}`)],
    ['a day that does not exist', encode(`2026-02-31T09:30:00.123456Z|${cursor.id}`)],
    ['SQL', encode(`2026-10-07T09:30:00.123456Z'; DROP TABLE x;--|${cursor.id}`)],
  ])('refuses %s with a 400', (_name, value) => {
    expect(() => decodeCursor(value)).toThrow(ApiError);
    expect(() => decodeCursor(value)).toThrow(/page link is not valid/);
  });
});
