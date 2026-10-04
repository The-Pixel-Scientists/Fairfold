// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The first segment of the address names the funder (ADR 0019): `/northfield/…`.

import { slugSchema } from '@pixel-scientists/domain/platform';
import { createContext, useContext } from 'react';

/** The funder's slug if the first segment of the path is one, and null for `/`, `/how-applying-works` and anything else. */
export function tenantSlugOf(pathname: string): string | null {
  const [, first = ''] = pathname.split('/');
  const slug = slugSchema.safeParse(first);
  return slug.success ? slug.data : null;
}

const TenantContext = createContext<string | null>(null);

export const TenantProvider = TenantContext.Provider;

/** The slug of the funder whose pages these are. */
export function useTenantSlug(): string {
  const slug = useContext(TenantContext);
  if (slug === null) throw new Error('useTenantSlug must be used inside a TenantProvider.');
  return slug;
}
