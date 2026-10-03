// SPDX-License-Identifier: AGPL-3.0-or-later

import { AppShell, Link, Router, cx } from '@pixelgrant/ui';
import type { RouteDefinition } from '@pixelgrant/ui';
import type { ReactNode } from 'react';

/** Component gallery: development builds only. The production build drops it. */
const developmentRoutes: readonly RouteDefinition[] = import.meta.env.DEV
  ? [
      {
        path: '/dev/components',
        title: 'Component gallery',
        load: () => import('./pages/ComponentGalleryPage.tsx'),
      },
    ]
  : [];

export const routes: readonly RouteDefinition[] = [
  { path: '/', title: 'Programmes', load: () => import('./pages/ProgrammesPage.tsx') },
  ...developmentRoutes,
];

const navigationLinkClassName = cx(
  'flex min-h-control items-center rounded-md px-control-x text-body text-ink no-underline',
  'hover:bg-sunken hover:text-ink',
  'aria-[current=page]:bg-accent-soft aria-[current=page]:font-semibold aria-[current=page]:text-accent',
  'aria-[current=page]:underline aria-[current=page]:decoration-2 aria-[current=page]:underline-offset-4',
);

function ConsoleNavigation() {
  return (
    <ul className="flex flex-wrap gap-1 md:flex-col">
      <li>
        <Link to="/" className={navigationLinkClassName}>
          Programmes
        </Link>
      </li>
      {import.meta.env.DEV && (
        <li>
          <Link to="/dev/components" className={navigationLinkClassName}>
            Component gallery
          </Link>
        </li>
      )}
    </ul>
  );
}

function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell productName="PixelGrant" areaName="Staff console" navigation={<ConsoleNavigation />}>
      {children}
    </AppShell>
  );
}

export function App() {
  return <Router routes={routes} layout={ConsoleLayout} titleSuffix="PixelGrant console" />;
}
