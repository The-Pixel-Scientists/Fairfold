// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The embed origin routes (ADR 0035), matched with their contracts.

import {
  addEmbedOrigin,
  listEmbedOrigins,
  removeEmbedOrigin,
} from '@pixel-scientists/domain/platform/settings';

import { ApiError } from '../../../problems.ts';
import { route, type Route } from '../../../routes/register.ts';
import {
  addEmbedOriginHandler,
  listEmbedOriginsHandler,
  removeEmbedOriginHandler,
} from './handlers.ts';

export const embedOriginRoutes: readonly Route[] = [
  route(listEmbedOrigins, listEmbedOriginsHandler),
  route(addEmbedOrigin, addEmbedOriginHandler, {
    replay: async ({ tx, context, id }) => {
      const { origins } = await listEmbedOriginsHandler({ tx, context, input: {} });
      const found = origins.find((origin) => origin.id === id);
      if (found === undefined) throw new ApiError(404, undefined, { reason: 'not_found' });
      return found;
    },
  }),
  route(removeEmbedOrigin, removeEmbedOriginHandler),
];
