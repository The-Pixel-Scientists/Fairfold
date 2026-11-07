// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { serializeError } from '../serialize-error.ts';
import { OutboundError, type OutboundCode } from './errors.ts';

const CODES: OutboundCode[] = [
  'scheme_refused',
  'method_refused',
  'address_refused',
  'unresolvable',
  'redirect_refused',
  'too_many_redirects',
  'body_too_large',
  'encoding_refused',
  'destination_refused',
  'timeout',
];

describe('an outbound refusal', () => {
  it.each(CODES)('logs %s as its fixed message and code, and nothing of the request', (code) => {
    const logged = serializeError(new OutboundError(code));

    expect(logged).toMatchObject({ type: 'OutboundError', code });
    expect(logged.message).toMatch(/^[A-Z][A-Za-z ,]+\.$/);
    expect(logged.cause).toBeUndefined();
  });
});
