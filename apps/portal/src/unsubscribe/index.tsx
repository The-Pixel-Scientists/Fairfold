// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from '@pixel-scientists/ui';
import { useMemo } from 'react';
import type { ReactNode } from 'react';

import { pageLoadErrorPage } from '../pages/PageLoadErrorPage.tsx';
import { productName } from '../product.ts';
import { PortalShell } from '../shell/PortalShell.tsx';
import { UnsubscribePage } from './UnsubscribePage.tsx';

/** `/<slug>/unsubscribe`: where an unsubscribe link's page is served, with `?token=` after it. */
export function isUnsubscribePath(pathname: string, slug: string): boolean {
  return pathname.replace(/\/$/, '') === `/${slug}/unsubscribe`;
}

function Layout({ children }: { children: ReactNode }) {
  return <PortalShell>{children}</PortalShell>;
}

/**
 * The page on its own, outside the funder's providers: no session is read and
 * no funder is looked up, so the link's one GET is the only request on load.
 */
export function UnsubscribeApp({ slug }: { slug: string }) {
  const routes = useMemo(
    () => [
      {
        path: '/unsubscribe',
        title: 'Unsubscribe',
        component: () => <UnsubscribePage preferencesHref={`/${slug}/preferences`} />,
      },
    ],
    [slug],
  );
  return (
    <Router
      routes={routes}
      layout={Layout}
      errorPage={pageLoadErrorPage}
      basePath={`/${slug}`}
      titleSuffix={productName}
    />
  );
}
