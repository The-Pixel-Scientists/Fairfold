// SPDX-License-Identifier: AGPL-3.0-or-later

import { AppShell, TenantLogo } from '@pixel-scientists/ui';
import type { ReactNode } from 'react';

import { useFunder } from './funder.tsx';
import { HOME_PATH } from './paths.ts';
import { productName } from './product.ts';

/**
 * The frame around every portal page: a skip link, a header and the main
 * landmark, in the roomier comfortable density. There is no side navigation.
 * Each screen is one task, and says where to go next. Inside a funder's
 * address the header shows the funder's logo, or its name when it has none.
 */
export function PortalShell({ actions, children }: { actions?: ReactNode; children: ReactNode }) {
  const funder = useFunder();
  const logo =
    funder?.status === 'ready' ? (
      <TenantLogo slug={funder.slug} name={funder.name} hasLogo={funder.hasLogo} />
    ) : null;

  return (
    <AppShell
      productName={productName}
      homeHref={HOME_PATH}
      areaName="Applications"
      density="comfortable"
      actions={
        logo || actions ? (
          <>
            {logo}
            {actions}
          </>
        ) : undefined
      }
    >
      {children}
    </AppShell>
  );
}
