// SPDX-License-Identifier: AGPL-3.0-or-later
//
// How the one-click unsubscribe POST reaches the route (RFC 8058). A mail
// client sends `List-Unsubscribe=One-Click` as an HTML form, which the API
// otherwise refuses, so this reads that content type for a route marked as a
// one-click unsubscribe and for no other: anything else gets the usual 415.
// A key sent twice becomes a list, which the contract's strict body refuses.
// Both routes of the link send `Referrer-Policy: no-referrer`, so the token
// in the URL never leaves in a Referer header.

import type { Buffer } from 'node:buffer';

import { getUnsubscribe } from '@pixel-scientists/party/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { ApiError } from '../../problems.ts';

const FORM = 'application/x-www-form-urlencoded';

type Form = Record<string, string | string[]>;

const contractOf = (request: FastifyRequest) =>
  (
    request.routeOptions.config as
      { contract?: { path?: unknown; oneClickUnsubscribe?: unknown } } | undefined
  )?.contract;

function parseForm(text: string): Form {
  const fields: Form = Object.create(null) as Form;
  for (const [key, value] of new URLSearchParams(text)) {
    const seen = fields[key];
    fields[key] = seen === undefined ? value : [seen, value].flat();
  }
  return fields;
}

/** Call once on the scope the routes are registered on, when any route is a one-click unsubscribe. */
export function registerUnsubscribeTransport(app: FastifyInstance): void {
  app.addContentTypeParser(FORM, { parseAs: 'buffer' }, (request, body, done) => {
    if (contractOf(request)?.oneClickUnsubscribe !== true) {
      done(new ApiError(415, undefined, { reason: 'not_json' }));
      return;
    }
    done(null, parseForm((body as Buffer).toString('utf8')));
  });
  // On send, so a problem's own headers, which are set afresh, do not replace it.
  app.addHook('onSend', (request, reply, payload, done) => {
    if (contractOf(request)?.path === getUnsubscribe.path) {
      void reply.header('referrer-policy', 'no-referrer');
    }
    done(null, payload);
  });
}
