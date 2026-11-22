// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { checkRoute, type RouteContract } from '../api/route.ts';
import { requestProblems } from '../api/schema-rules.ts';
import {
  callbackReferenceSchema,
  signatureCallbackParamsSchema,
  signatureCallbackPath,
} from './routes.ts';

const REFERENCE = 'q0JX3vYk1a_-ZmN9pLr2sT4uVw6xYz8AbCdEfGhIjKl';

describe('the signature callback contract', () => {
  it('takes a reference of 32 random bytes as base64url, and nothing else', () => {
    expect(REFERENCE).toHaveLength(43);
    expect(signatureCallbackParamsSchema.parse({ reference: REFERENCE })).toEqual({
      reference: REFERENCE,
    });
    for (const reference of [
      `${REFERENCE}=`,
      REFERENCE.slice(1),
      `${REFERENCE.slice(1)}+`,
      '0b8f3a52-6c1d-4e7a-9f20-3d5c8e1b7a64',
      'northfield',
    ]) {
      expect(callbackReferenceSchema.safeParse(reference).success, reference).toBe(false);
    }
    const extra = { reference: REFERENCE, tenant: 'northfield' };
    expect(signatureCallbackParamsSchema.safeParse(extra).success).toBe(false);
    expect(requestProblems(signatureCallbackPath, 'params', signatureCallbackParamsSchema)).toEqual(
      [],
    );
  });

  // S12-85 registers the route. Until path parameters may be a callback
  // reference, checkRoute() refuses it for that alone: public, no session, no
  // body schema and a bare 204 already keep every other rule.
  it('breaks no route rule but the path parameter rule', () => {
    const route: RouteContract = {
      audience: 'public',
      module: 'platform',
      permission: null,
      scope: null,
      method: 'POST',
      path: signatureCallbackPath,
      summary: 'Tell the service a signature request may have changed',
      params: signatureCallbackParamsSchema,
      responses: { 204: null },
    };
    expect(checkRoute(route)).toEqual([
      'The path parameter :reference must be required, and an id, a field id or the tenant slug.',
    ]);
  });
});
