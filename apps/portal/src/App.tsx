// SPDX-License-Identifier: AGPL-3.0-or-later

import { productName } from '@pixel-scientists/domain/platform';
import { AppShell, Router } from '@pixel-scientists/ui';
import type { RouteDefinition } from '@pixel-scientists/ui';
import type { ReactNode } from 'react';

import { pageLoadErrorPage } from './pages/PageLoadErrorPage.tsx';
import { HOME_PATH, HOW_APPLYING_WORKS_PATH } from './paths.ts';

const routes: readonly RouteDefinition[] = [
  { path: HOME_PATH, title: 'Apply for a grant', load: () => import('./pages/HomePage.tsx') },
  {
    path: HOW_APPLYING_WORKS_PATH,
    title: 'How applying works',
    load: () => import('./pages/HowApplyingWorksPage.tsx'),
  },
];

/**
 * The frame around every page: a skip link, a header and the main landmark,
 * in the roomier comfortable density. There is no side navigation. Each
 * screen is one task, and says where to go next.
 */
function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell
      productName={productName}
      homeHref={HOME_PATH}
      areaName="Applications"
      density="comfortable"
    >
      {children}
    </AppShell>
  );
}

export function App() {
  return (
    <Router
      routes={routes}
      layout={PortalLayout}
      errorPage={pageLoadErrorPage}
      titleSuffix={productName}
    />
  );
}
