// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Composes the modules (ADR 0016): each module's routes, matched with their
// contracts, its scope rule resolvers, and any platform dependency the module
// declares. A module never imports from this app; the platform reaches it
// only through its server entry point.

import { listAuditEvents } from '@pixel-scientists/domain/platform/audit-log';
import { partyRoutes } from '@pixel-scientists/party/contracts';
import { partyHandlers, partyResolvers } from '@pixel-scientists/party/server';

import type { PublicTenants } from './database.ts';
import { listAuditEventsHandler } from './platform/audit-log/index.ts';
import { settingsRoutes } from './platform/settings/index.ts';
import type { ScopeResolvers } from './policy/index.ts';
import { ApiError } from './problems.ts';
import { publicRoutes } from './public/index.ts';
import { route, type Route } from './routes/register.ts';

export interface ComposedModules {
  readonly routes: readonly Route[];
  readonly resolvers: ScopeResolvers;
}

/** A record the caller may not reach reads exactly as a missing one does. */
const notFound = (): Error => new ApiError(404, undefined, { reason: 'not_found' });

export function composeModules(deps: { publicTenants: PublicTenants }): ComposedModules {
  const party = partyHandlers({ notFound });
  return {
    routes: [
      route(listAuditEvents, listAuditEventsHandler),
      ...settingsRoutes,
      ...publicRoutes(deps.publicTenants),
      route(partyRoutes.getProfile, party.getProfile),
      route(partyRoutes.updateProfile, party.updateProfile),
      route(partyRoutes.recordConsent, party.recordConsent),
      route(partyRoutes.listMyOrganisations, party.listMyOrganisations),
      route(partyRoutes.createOrganisation, party.createOrganisation),
      route(partyRoutes.getMyOrganisation, party.getMyOrganisation),
      route(partyRoutes.updateMyOrganisation, party.updateMyOrganisation),
      route(partyRoutes.listOrganisations, party.listOrganisations),
      route(partyRoutes.getOrganisation, party.getOrganisation),
      route(partyRoutes.getPerson, party.getPerson),
    ],
    resolvers: partyResolvers,
  };
}
