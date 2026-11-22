// SPDX-License-Identifier: AGPL-3.0-or-later

import { FormsHostProvider } from '@pixel-scientists/forms/portal';
import type { FormsHost } from '@pixel-scientists/forms/portal';
import type { ReactNode } from 'react';

import { callApi } from '../api.ts';
import { useDraft } from '../party/drafts.ts';
import { useTenantSlug } from '../tenant.ts';

const host = (slug: string): FormsHost => ({ call: callApi, slug, embedded: false, useDraft });

/** Gives the forms pages the portal's API client and its place for unsaved answers. */
export function PortalFormsHost({ children }: { children: ReactNode }) {
  const slug = useTenantSlug();
  return <FormsHostProvider host={host(slug)}>{children}</FormsHostProvider>;
}
