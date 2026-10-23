// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The public tenant routes (S03-04), matched with their contracts.

import { getLogo, getPublicTenant, getThemeCss } from '@pixel-scientists/domain/platform/settings';

import type { PublicTenants } from '../database.ts';
import { route, type Route } from '../routes/register.ts';
import { publicHandlers, type PublicLog } from './tenants.ts';

export function publicRoutes(tenants: PublicTenants, log?: PublicLog): readonly Route[] {
  const handlers = publicHandlers(tenants, log);
  return [
    route(getPublicTenant, handlers.getPublicTenantHandler),
    route(getThemeCss, handlers.getThemeCssHandler),
    route(getLogo, handlers.getLogoHandler),
  ];
}
