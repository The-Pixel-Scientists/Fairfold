// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The origins a tenant allows to frame its embeds (ADR 0035), stored in
// `app.embed_origin`. An empty list means embeds are refused, not open.
//
// Console routes list, add and remove them under the settings permission.
// Each change writes a `platform.embed_origins` config version and a
// `platform.embed_origin.added` or `.removed` audit event in one transaction.
// Adding an origin already listed, or a 21st, answers 409.
//
// The public read is for the embed host's web server, which builds
// `frame-ancestors` from it. It has no permission or scope: the API answers
// it only through `app.embed_origins(slug)`, with no tenant set, and gives
// an unknown, suspended or malformed slug, or a tenant without a module that
// offers embeds switched on, the API's one not-found problem, which never
// repeats the slug.

import { z } from 'zod';

import { defineRoute } from '../../api/route.ts';
import { idSchema } from '../../id.ts';
import { messages } from '../messages.ts';
import { slugSchema } from '../tenant.ts';

/** The most origins a tenant lists. */
export const MAX_EMBED_ORIGINS = 20;

/** `https://`, the longest DNS name and a port. */
export const MAX_EMBED_ORIGIN_LENGTH = 8 + 253 + 6;

const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
/** The last label starts with a letter, so no IP address passes. */
const TOP_LABEL = '[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?';

/**
 * `https://host` or `https://host:port`, lower case: a DNS name of two or
 * more labels in ASCII (an international name in its `xn--` form), and
 * nothing else. The check on `app.embed_origin.origin` repeats it.
 */
export const embedOriginPattern = new RegExp(
  `^https://(?:${LABEL}\\.)+${TOP_LABEL}(?::[1-9][0-9]{0,4})?$`,
);

/** No path, query, fragment, user information, wildcard or IP literal; the host is lower-cased. */
export const embedOriginSchema = z
  .string()
  .trim()
  .max(MAX_EMBED_ORIGIN_LENGTH, { error: messages.httpsAddress })
  .toLowerCase()
  .regex(embedOriginPattern, { error: messages.httpsAddress })
  .refine((origin) => Number(origin.split(':')[2] ?? 443) <= 65_535, {
    error: messages.httpsAddress,
  });

export const embedOriginInputSchema = z.strictObject({ origin: embedOriginSchema });

export type EmbedOriginInput = z.infer<typeof embedOriginInputSchema>;

export const embedOriginRowSchema = z.strictObject({
  id: idSchema,
  origin: embedOriginSchema,
  createdAt: z.iso.datetime(),
});

export type EmbedOriginRow = z.infer<typeof embedOriginRowSchema>;

/** The tenant's origins, oldest first. */
export const embedOriginListSchema = z.strictObject({
  origins: z.array(embedOriginRowSchema).max(MAX_EMBED_ORIGINS),
});

export type EmbedOriginList = z.infer<typeof embedOriginListSchema>;

/** Origins only: never an id, a tenant or who added them. */
export const publicEmbedOriginsSchema = z.strictObject({
  origins: z.array(embedOriginSchema).max(MAX_EMBED_ORIGINS),
});

export type PublicEmbedOrigins = z.infer<typeof publicEmbedOriginsSchema>;

const manage = {
  audience: 'console',
  module: 'platform',
  permission: 'platform.settings.manage',
  scope: 'tenant',
} as const;

export const listEmbedOrigins = defineRoute({
  ...manage,
  method: 'GET',
  path: '/console/settings/embed-origins',
  summary: "List the websites allowed to show the tenant's embedded pages",
  responses: { 200: embedOriginListSchema },
});

export const addEmbedOrigin = defineRoute({
  ...manage,
  method: 'POST',
  idempotent: true,
  path: '/console/settings/embed-origins',
  summary: "Allow a website to show the tenant's embedded pages, up to 20",
  body: embedOriginInputSchema,
  responses: { 201: embedOriginRowSchema },
});

export const removeEmbedOrigin = defineRoute({
  ...manage,
  method: 'DELETE',
  path: '/console/settings/embed-origins/:originId',
  summary: "Stop a website showing the tenant's embedded pages",
  params: z.strictObject({ originId: idSchema }),
  responses: { 204: null },
});

export const getPublicEmbedOrigins = defineRoute({
  audience: 'public',
  module: 'platform',
  permission: null,
  scope: null,
  method: 'GET',
  path: '/public/tenants/:slug/embed-origins',
  summary: "Read the websites allowed to show an active tenant's embedded pages",
  params: z.strictObject({ slug: slugSchema }),
  responses: { 200: publicEmbedOriginsSchema },
});

export const embedOriginRoutes = { listEmbedOrigins, addEmbedOrigin, removeEmbedOrigin } as const;

/** The route with no permission here, for the API's checks and review. */
export const publicEmbedOriginRoutes = { getPublicEmbedOrigins } as const;
