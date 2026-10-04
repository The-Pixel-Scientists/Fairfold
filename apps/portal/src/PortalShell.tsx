// SPDX-License-Identifier: AGPL-3.0-or-later

import { AppShell } from '@pixel-scientists/ui';
import type { ReactNode } from 'react';

import { HOME_PATH } from './paths.ts';
import { productName } from './product.ts';

/**
 * The frame around every portal page: a skip link, a header and the main
 * landmark, in the roomier comfortable density. There is no side navigation.
 * Each screen is one task, and says where to go next.
 */
export function PortalShell({ actions, children }: { actions?: ReactNode; children: ReactNode }) {
  return (
    <AppShell
      productName={productName}
      homeHref={HOME_PATH}
      areaName="Applications"
      density="comfortable"
      actions={actions}
    >
      {children}
    </AppShell>
  );
}
