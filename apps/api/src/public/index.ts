// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The public tenant routes (S03-04), matched with their contracts.

import {
  getLogo,
  getPublicEmbedOrigins,
  getPublicTenant,
  getThemeCss,
} from '@pixel-scientists/domain/platform/settings';
import { getPublicRound, listPublicRounds } from '@pixel-scientists/grants/contracts';

import type { PublicTenants } from '../database.ts';
import { route, type Route } from '../routes/register.ts';
import { embedOriginHandlers } from './embed-origins/handlers.ts';
import { programmeHandlers } from './programmes/handlers.ts';
import { publicHandlers, type PublicLog } from './tenants.ts';

export function publicRoutes(tenants: PublicTenants, log?: PublicLog): readonly Route[] {
  const handlers = publicHandlers(tenants, log);
  const programmes = programmeHandlers(tenants);
  return [
    route(getPublicTenant, handlers.getPublicTenantHandler),
    route(getThemeCss, handlers.getThemeCssHandler),
    route(getLogo, handlers.getLogoHandler),
    route(listPublicRounds, programmes.listPublicRoundsHandler),
    route(getPublicRound, programmes.getPublicRoundHandler),
    route(getPublicEmbedOrigins, embedOriginHandlers(tenants).getPublicEmbedOriginsHandler),
  ];
}
