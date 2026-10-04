// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The headers every API response carries (ADR 0006): the request id, and the
// ones that keep a browser from caching, sniffing, framing or leaking from a
// JSON response.

import type { FastifyReply, FastifyRequest } from 'fastify';

const RESPONSE_HEADERS = {
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'cross-origin-opener-policy': 'same-origin',
  'permissions-policy':
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=()',
  'referrer-policy': 'same-origin',
  'x-content-type-options': 'nosniff',
} as const;

const HSTS = 'max-age=63072000; includeSubDomains';

/** Called for every request, and again for an error raised before routing, so no answer lacks them. */
export function setResponseHeaders(request: FastifyRequest, reply: FastifyReply): void {
  reply.header('x-request-id', request.id).headers(RESPONSE_HEADERS);
  if (request.protocol === 'https') reply.header('strict-transport-security', HSTS);
}
