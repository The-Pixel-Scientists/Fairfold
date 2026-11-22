// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The signature callback (ADR 0040), the riskiest surface in documents: an
// unauthenticated route that leads to tenant data. Its contract is kept
// minimal, as S12-85 builds it:
//
//   POST /public/signature-callbacks/:reference, module `platform`,
//   `permission: null`, `scope: null`, no session, answering 204 with no
//   body, the same for an unknown reference as for a known one.
//
// The reference is per connection: 32 random bytes as base64url, held only
// in the webhook address at the provider, stored only as its SHA-256. It
// names no tenant and no request, and is a bearer value, so no log line,
// span, rate-limit record, audit event, job payload or problem detail ever
// holds it; logs show the route's pattern. It takes no `body` schema:
// checkRoute() allows raw bodies only on console and portal routes, so the
// handler reads the raw bytes itself, and no problem detail echoes a body
// value.
//
// The handler, in order:
//   1. refuses a body over MAX_CALLBACK_BODY_BYTES with 413 before reading
//      further, and any type but JSON with 415;
//   2. counts the request against the `signature_callback_reference` limit
//      (S11-36, ADR 0028), keyed by the reference's HMAC, with 429;
//   3. finds the connection's tenant and key version only through the
//      approved definer function `app.resolve_signature_callback()` (S12-62)
//      by the reference's SHA-256, and sets no tenant itself (ADR 0019);
//   4. verifies the provider's signature over the raw body with the secret
//      derived for that connection, in constant time and within 5 minutes
//      where the provider signs a timestamp; an unknown reference is
//      verified against a fixed dummy key, so it costs the same work;
//   5. only then parses the body with callbackHintSchema, ignoring any
//      status in it;
//   6. records the hint through `app.record_signature_callback()`, which
//      refuses a replay by its event id and lets the worker send one
//      ids-only refresh job per request (ADR 0009);
//   7. answers 204 whatever steps 3 to 6 found. Only a database outage
//      before step 3 answers 503.
// The worker never takes a status from a callback: it re-reads it from the
// provider.

import { z } from 'zod';

export const signatureCallbackPath = '/public/signature-callbacks/:reference';

/** 64 KiB; the proxy's 1 MiB limit is a first layer. */
export const MAX_CALLBACK_BODY_BYTES = 64 * 1024;

/** 32 random bytes as unpadded base64url. */
export const callbackReferenceSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const signatureCallbackParamsSchema = z.strictObject({
  reference: callbackReferenceSchema,
});
