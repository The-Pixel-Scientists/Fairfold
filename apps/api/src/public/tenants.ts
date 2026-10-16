// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the portal reads before anyone signs in (ADR 0019): a tenant's name,
// theme tokens, stylesheet and logo, by its slug. The routes need no session
// and set no tenant; they reach the data only through the two public
// functions, which answer for an active tenant alone. An unknown, suspended
// or malformed slug, and a tenant with no logo, all answer the same 404.

import { defaultTheme } from '@pixel-scientists/domain/platform';
import {
  themeCss,
  type getLogo,
  type getPublicTenant,
  type getThemeCss,
} from '@pixel-scientists/domain/platform/settings';

import type { PublicTenants } from '../database.ts';
import { ApiError } from '../problems.ts';
import type { Handler } from '../routes/register.ts';

const notFound = (): Error => new ApiError(404, undefined, { reason: 'not_found' });

/** The stylesheet for the stored tokens; the default look if they no longer pass the contrast check. */
function stylesheet(tokens: Parameters<typeof themeCss>[0]): string {
  try {
    return themeCss(tokens);
  } catch {
    return themeCss(defaultTheme);
  }
}

export function publicHandlers(tenants: PublicTenants) {
  const getPublicTenantHandler: Handler<typeof getPublicTenant> = async ({ input }) => {
    const found = await tenants.tenant(input.params.slug);
    if (found === undefined) throw notFound();
    return { name: found.name, theme: found.theme };
  };

  const getThemeCssHandler: Handler<typeof getThemeCss> = async ({ input }) => {
    const found = await tenants.tenant(input.params.slug);
    if (found === undefined) throw notFound();
    return { type: 'text/css', body: stylesheet(found.theme) };
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
