// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Browsing a tenant's open rounds before sign-in (E6, ADR 0019, ADR 0035):
// the only grants routes reachable without a session. They have no
// permission or scope. The API answers them only through
// `grants.public_open_rounds(slug)`, which resolves the tenant from the slug
// inside itself; no tenant context is set, and no request names a tenant or
// a user.
//
// Not found is one answer. An unknown slug, a suspended tenant, a tenant
// with grants switched off or never switched on (ADR 0024), and a round that
// is closed, draft, not yet open, or another tenant's all get the API's one
// not-found problem, word for word the same, which never repeats the slug or
// the round id. A different answer would tell a stranger which modules a
// tenant uses, or let them enumerate rounds. The second route filters the
// first; it never reads a round the list would not show.
//
// Reading public fields is not a sensitive read, so neither route is audited.

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute } from '@pixel-scientists/domain/api';
import { slugSchema } from '@pixel-scientists/domain/platform';
import { z } from 'zod';

import { publicRoundListSchema, publicRoundSchema } from './schemas.ts';

const publicRound = {
  audience: 'public',
  module: 'grants',
  permission: null,
  scope: null,
  method: 'GET',
} as const;

export const listPublicRounds = defineRoute({
  ...publicRound,
  path: '/public/tenants/:slug/rounds',
  summary: "List an active tenant's open rounds, closing soonest first, up to 100",
  params: z.strictObject({ slug: slugSchema }),
  responses: { 200: publicRoundListSchema },
});

export const getPublicRound = defineRoute({
  ...publicRound,
  path: '/public/tenants/:slug/rounds/:roundId',
  summary: "Read one of an active tenant's open rounds",
  params: z.strictObject({ slug: slugSchema, roundId: idSchema }),
  responses: { 200: publicRoundSchema },
});

/** Every route with no permission here, for the API's checks and review. */
export const publicRoundRoutes = { listPublicRounds, getPublicRound } as const;
