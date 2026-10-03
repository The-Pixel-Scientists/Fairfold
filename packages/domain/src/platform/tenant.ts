// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A tenant's slug names it in app URLs (`/northfield/…`) and in the two API
// path prefixes that may carry it (ADR 0019).

import { z } from 'zod';

import { messages } from './messages.ts';

/**
 * Names the apps' origins serve at the top level, so a tenant called one of
 * them would collide with the API, the apps' own files or a page outside any
 * tenant. Each app adds its top-level routes here. `app.tenant` refuses them
 * too.
 */
export const reservedSlugs: readonly string[] = [
  'api',
  'assets',
  'auth',
  'console',
  'dev',
  'health',
  'how-applying-works',
  'portal',
  'public',
];

/** The same pattern as the check on `app.tenant.slug`. */
export const slugPattern = /^[a-z](?:[a-z0-9]|-(?=[a-z0-9])){2,39}$/;

export const slugSchema = z
  .string()
  .regex(slugPattern, { error: messages.slugFormat })
  .refine((slug) => !reservedSlugs.includes(slug), { error: messages.slugReserved });
