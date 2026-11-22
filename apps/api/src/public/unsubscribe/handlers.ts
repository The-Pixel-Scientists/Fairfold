// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The public unsubscribe link (ADR 0033, RFC 8058). There is no session and
// no tenant. The token is verified here, under its own key, before anything
// reaches the database, and every bad token, and every person the database
// refuses, gets the same 404, so nothing says whether a person or tenant
// exists. GET only reads the token and changes nothing, because mail scanners
// follow links. POST records one withdrawal through the approved function and
// answers without a redirect. Neither writes the token to a log or a problem.

import type {
  confirmUnsubscribe,
  getUnsubscribe,
  unsubscribeOutcomes,
} from '@pixel-scientists/party/contracts';

import { verifyUnsubscribeToken, type UnsubscribeKeys } from '../../email/unsubscribe-token.ts';
import { ApiError } from '../../problems.ts';
import type { Handler } from '../../routes/register.ts';
import type { UnsubscribeStore } from './store.ts';

const notFound = (): Error => new ApiError(404, undefined, { reason: 'not_found' });

type Outcome = (typeof unsubscribeOutcomes)[number];

const outcomes: ReadonlyMap<string, Outcome> = new Map([
  ['unsubscribed', 'unsubscribed'],
  ['already_unsubscribed', 'already_unsubscribed'],
]);

export function unsubscribeHandlers(deps: {
  readonly keys: UnsubscribeKeys;
  readonly store: UnsubscribeStore;
}) {
  const getUnsubscribeHandler: Handler<typeof getUnsubscribe> = ({ input }) => {
    const target = verifyUnsubscribeToken(deps.keys, input.query.token);
    if (target === undefined) return Promise.reject(notFound());
    return Promise.resolve({ purpose: target.purpose, channel: target.channel });
  };

  const confirmUnsubscribeHandler: Handler<typeof confirmUnsubscribe> = async ({
    context,
    input,
  }) => {
    const target = verifyUnsubscribeToken(deps.keys, input.query.token);
    if (target === undefined) throw notFound();
    const code = await deps.store.record(target, context.requestId);
    const outcome = outcomes.get(code);
    // `refused`: unknown or inactive tenant, unknown or erased person.
    if (outcome === undefined) {
      if (code === 'refused') throw notFound();
      throw new Error('The unsubscribe function answered an unknown code.');
    }
    return { outcome };
  };

  return { getUnsubscribeHandler, confirmUnsubscribeHandler };
}
