// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The funder's public name and look, read before anyone signs in (ADR 0019),
// so every page of the console, signed in or not, shows them.

import { getPublicTenant } from '@pixel-scientists/domain/platform/settings';
import type { PublicTenant } from '@pixel-scientists/domain/platform/settings';
import { TenantTheme, refreshTenantAssets } from '@pixel-scientists/ui';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { callApi } from '../../api.ts';
import { useTenantSlug } from '../../tenant.ts';

interface LookValue {
  /** Null until it has been read, and for a funder the API does not know, which keeps the standard look. */
  tenant: PublicTenant | null;
  /** Changes each time the look is read again, for the logo and stylesheet to be drawn afresh. */
  version: number;
  /** Read it again after the funder changes its name or look. */
  refresh: () => Promise<void>;
}

const LookContext = createContext<LookValue | null>(null);

/** Reads the funder's name and look, and applies the look to the page. */
export function TenantLook({ children }: { children: ReactNode }) {
  const slug = useTenantSlug();
  const [tenant, setTenant] = useState<PublicTenant | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let current = true;
    callApi(getPublicTenant, { params: { slug } }).then(
      (read) => {
        if (current) setTenant(read);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [slug]);

  const refresh = useCallback(async () => {
    const read = await callApi(getPublicTenant, { params: { slug } });
    await refreshTenantAssets(slug);
    setTenant(read);
    setVersion((count) => count + 1);
  }, [slug]);

  const value = useMemo(() => ({ tenant, version, refresh }), [tenant, version, refresh]);

  return (
    <LookContext.Provider value={value}>
      {tenant !== null && (
        <TenantTheme slug={slug} preset={tenant.theme.preset} version={version} />
      )}
      {children}
    </LookContext.Provider>
  );
}

export function useTenantLook(): LookValue {
  const value = useContext(LookContext);
  if (value === null) throw new Error('useTenantLook must be used inside a TenantLook.');
  return value;
}
