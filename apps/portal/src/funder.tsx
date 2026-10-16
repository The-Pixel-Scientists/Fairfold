// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The funder's public name and look, read before anyone signs in (ADR 0019),
// so every page of the funder's portal shows them.

import { ProblemError } from '@pixel-scientists/domain/api';
import { getPublicTenant } from '@pixel-scientists/domain/platform/settings';
import { TenantTheme } from '@pixel-scientists/ui';
import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { callApi } from './api.ts';
import { useTenantSlug } from './tenant.ts';

export type Funder =
  | { status: 'loading' }
  /** The API does not know this funder: the link is wrong. */
  | { status: 'missing' }
  /** The funder could not be read. The portal still works, in the standard look and without the name. */
  | { status: 'unavailable' }
  | { status: 'ready'; slug: string; name: string; hasLogo: boolean; preset: string };

const FunderContext = createContext<Funder | null>(null);

/** Reads the funder's name and look, and applies the look to the page. */
export function FunderProvider({ children }: { children: ReactNode }) {
  const slug = useTenantSlug();
  const [funder, setFunder] = useState<Funder>({ status: 'loading' });

  useEffect(() => {
    let current = true;
    callApi(getPublicTenant, { params: { slug } }).then(
      (tenant) => {
        if (!current) return;
        const { name, theme } = tenant;
        setFunder({ status: 'ready', slug, name, hasLogo: theme.hasLogo, preset: theme.preset });
      },
      (error: unknown) => {
        if (current) {
          setFunder({
            status:
              error instanceof ProblemError && error.status === 404 ? 'missing' : 'unavailable',
          });
        }
      },
    );
    return () => {
      current = false;
    };
  }, [slug]);

  return (
    <FunderContext.Provider value={funder}>
      {funder.status === 'ready' && <TenantTheme slug={slug} preset={funder.preset} />}
      {children}
    </FunderContext.Provider>
  );
}

/** The funder in the address; null on the pages outside any funder's address. */
export function useFunder(): Funder | null {
  return useContext(FunderContext);
}

/** The funder's name, or null while it is not known. */
export function useFunderName(): string | null {
  const funder = useFunder();
  return funder?.status === 'ready' ? funder.name : null;
}
