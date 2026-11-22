// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Test helpers: a funder's form built through the contracts so a fixture cannot
// drift from them, and a stand-in for the host that records what the pages
// send. Synthetic data only. Not part of the module.

import type { JsonRouteContract } from '@pixel-scientists/domain/api';
import { formDefinitionSchema } from '@pixel-scientists/domain/forms';
import { Router } from '@pixel-scientists/ui';
import type { RouteDefinition } from '@pixel-scientists/ui';
import type { ReactElement } from 'react';

import { proofChallengeResponseSchema, publicFormSchema } from '../contracts/index.ts';
import { FormsHostProvider, useMemoryDraft } from './host.tsx';
import type { FormsCall, FormsCallOptions, FormsHost } from './host.tsx';

export const FORM_ID = '2e4a6c8d-0b1f-4d3e-8a5c-7f9b1d3e5a70';
export const VERSION_ID = '7c1d3e5f-9a2b-4c4d-8e6f-0a1b2c3d4e5f';
export const NEW_VERSION_ID = '3b5d7f91-2c4e-4a6b-9d8c-1e0f2a3b4c5d';
export const RESPONSE_ID = '5e7f9a1b-3c5d-4e7f-8a9b-0c1d2e3f4a5b';

export const definition = formDefinitionSchema.parse({
  sections: [
    {
      id: 's_you',
      title: 'About you',
      fields: [
        { id: 'f_name', type: 'short_text', label: 'Your name', required: true },
        { id: 'f_town', type: 'short_text', label: 'Your town' },
      ],
    },
    {
      id: 's_more',
      title: 'Anything else',
      fields: [{ id: 'f_note', type: 'long_text', label: 'Your comment' }],
    },
  ],
});

export function publicForm(versionId = VERSION_ID, noProofFallback = true) {
  return publicFormSchema.parse({
    formId: FORM_ID,
    formVersionId: versionId,
    title: 'Funder A feedback',
    description: 'Tell Funder A how we did.',
    definition,
    noProofFallback,
  });
}

export const CHALLENGE = `${'a'.repeat(60)}.${'b'.repeat(42)}A`;

export function challengeReply() {
  return proofChallengeResponseSchema.parse({
    challenge: CHALLENGE,
    difficulty: 8,
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  });
}

export interface Sent {
  /** `POST /public/tenants/:slug/forms/:formId/responses`, as the contract writes it. */
  key: string;
  input: unknown;
  options: FormsCallOptions | undefined;
}

type Handler = (input: unknown, options: FormsCallOptions | undefined) => unknown;

/**
 * A host whose calls are answered from `handlers`, keyed by the route's method
 * and path. A handler returns the answer, or throws a ProblemError. A route
 * with no handler fails the test.
 */
export function fakeHost(
  handlers: Record<string, Handler>,
  embedded = false,
): { host: FormsHost; sent: Sent[] } {
  const sent: Sent[] = [];
  const call = ((route: JsonRouteContract, input: unknown, options?: FormsCallOptions) => {
    const key = `${route.method} ${route.path}`;
    sent.push({ key, input, options });
    const handler = handlers[key];
    if (handler === undefined) return Promise.reject(new Error(`Unexpected request: ${key}`));
    return new Promise((resolve, reject) => {
      try {
        resolve(handler(input, options) as never);
      } catch (error) {
        reject(error instanceof Error ? error : new Error('The handler failed.'));
      }
    });
  }) as FormsCall;
  return { host: { call, slug: 'tenant-a', embedded, useDraft: useMemoryDraft }, sent };
}

/** A page at an address, inside a router and a host, ready to render. */
export function pageAt(host: FormsHost, route: RouteDefinition, address: string): ReactElement {
  window.history.replaceState(null, '', address);
  return (
    <FormsHostProvider host={host}>
      <Router routes={[route]} />
    </FormsHostProvider>
  );
}
