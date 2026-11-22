// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The public unsubscribe routes (S12-71), matched with their contracts.

import { confirmUnsubscribe, getUnsubscribe } from '@pixel-scientists/party/contracts';

import type { UnsubscribeKeys } from '../../email/unsubscribe-token.ts';
import { route, type Route } from '../../routes/register.ts';
import { unsubscribeHandlers } from './handlers.ts';
import type { UnsubscribeStore } from './store.ts';

export { registerUnsubscribeTransport } from './transport.ts';
export { unsubscribeStoreOn, type UnsubscribeStore } from './store.ts';

export function unsubscribeRoutes(deps: {
  keys: UnsubscribeKeys;
  store: UnsubscribeStore;
}): readonly Route[] {
  const handlers = unsubscribeHandlers(deps);
  return [
    route(getUnsubscribe, handlers.getUnsubscribeHandler),
    route(confirmUnsubscribe, handlers.confirmUnsubscribeHandler),
  ];
}
