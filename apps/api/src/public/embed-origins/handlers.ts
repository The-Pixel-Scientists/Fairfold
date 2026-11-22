// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The websites allowed to frame a tenant's embeds, for the embed host's web
// server to build `frame-ancestors` from (ADR 0035). No session, no tenant:
// the function resolves the tenant from the slug. An unknown, suspended or
// switched-off tenant, and one with no origins, answer the same 404, and the
// host fails closed on any of them.

import {
  publicEmbedOriginsSchema,
  type getPublicEmbedOrigins,
} from '@pixel-scientists/domain/platform/settings';

import type { PublicTenants } from '../../database.ts';
import { ApiError } from '../../problems.ts';
import type { Handler } from '../../routes/register.ts';

export function embedOriginHandlers(tenants: PublicTenants) {
  const getPublicEmbedOriginsHandler: Handler<typeof getPublicEmbedOrigins> = async ({ input }) => {
    const origins = await tenants.embedOrigins(input.params.slug);
    if (origins.length === 0) throw new ApiError(404, undefined, { reason: 'not_found' });
    return publicEmbedOriginsSchema.parse({ origins });
  };
  return { getPublicEmbedOriginsHandler };
}
