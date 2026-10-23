// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the portal reads before anyone signs in (ADR 0019): a tenant's name,
// theme tokens, stylesheet and logo, by its slug. The routes need no session
// and set no tenant; they reach the data only through the two public
// functions, which answer for an active tenant alone. An unknown, suspended
// or malformed slug, and a tenant with no logo, all answer the same 404.
// The stylesheet is built from the tenant's own tokens when it has them, and
// from its preset look when it has none or they no longer pass the checks.

import { defaultTheme, type TokenSet } from '@pixel-scientists/domain/platform';
import {
  themeCss,
  type getLogo,
  type getPublicTenant,
  type getThemeCss,
} from '@pixel-scientists/domain/platform/settings';

import type { PublicTenantRow } from '@pixel-scientists/db';

import type { PublicTenants } from '../database.ts';
import { ApiError } from '../problems.ts';
import type { Handler } from '../routes/register.ts';

const notFound = (): Error => new ApiError(404, undefined, { reason: 'not_found' });

/** Where a stylesheet problem is logged, as a code and never the tokens. */
export interface PublicLog {
  warn(object: { code: string }, message: string): void;
}

/**
 * The stylesheet for the tenant's tokens, or for its preset look if it has
 * none or they no longer pass (a rule changed since they were saved), or the
 * default look if the stored colour fails contrast too.
 */
function stylesheet(found: PublicTenantRow, log: PublicLog | undefined): string {
  if (found.tokens !== null) {
    try {
      // themeCss() parses and checks the tokens itself before writing any value.
      return themeCss({ tokens: found.tokens as TokenSet });
    } catch {
      log?.warn({ code: 'theme_tokens_invalid' }, 'Stored theme tokens failed the checks');
    }
  }
  try {
    return themeCss(found.theme);
  } catch {
    return themeCss(defaultTheme);
  }
}

export function publicHandlers(tenants: PublicTenants, log?: PublicLog) {
  const getPublicTenantHandler: Handler<typeof getPublicTenant> = async ({ input }) => {
    const found = await tenants.tenant(input.params.slug);
    if (found === undefined) throw notFound();
    return { name: found.name, theme: found.theme };
  };

  const getThemeCssHandler: Handler<typeof getThemeCss> = async ({ input }) => {
    const found = await tenants.tenant(input.params.slug);
    if (found === undefined) throw notFound();
    return { type: 'text/css', body: stylesheet(found, log) };
  };

  const getLogoHandler: Handler<typeof getLogo> = async ({ input }) => {
    const found = await tenants.logo(input.params.slug);
    if (found === undefined) throw notFound();
    return {
      type: found.logoType,
      body: found.logo,
      headers: { 'content-disposition': 'inline' },
    };
  };

  return { getPublicTenantHandler, getThemeCssHandler, getLogoHandler };
}
