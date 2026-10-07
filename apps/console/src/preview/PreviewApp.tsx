// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Design previews of console screens not built yet, at /dev/preview in
// development builds only. They use the real components and a fixed
// synthetic story (story.ts), and are the designs the screens are built to.

import {
  AppShell,
  Button,
  Link,
  PageHeading,
  Router,
  useLocation,
  useNavigate,
} from '@pixel-scientists/ui';
import type { RouteDefinition } from '@pixel-scientists/ui';
import type { ReactNode } from 'react';

import { AuthFrame } from '../auth/AuthFrame.tsx';
import { productName, titleSuffix } from '../product.ts';
import { navLinkClassName } from '../shell/navLink.ts';
import { accountRoutes, signedOutPath } from './account/routes.ts';
import { decideRoutes } from './decide/routes.ts';
import { insightRoutes } from './insight/routes.ts';
import { isReviewerPath } from './review/reviewerPath.ts';
import { reviewRoutes } from './review/routes.ts';
import { settingsRoutes } from './settings/routes.ts';
import { formPreviewPath, setupRoutes } from './setup/routes.ts';
import { funder, reviewer, staff } from './story.ts';

/** The console's navigation once every Grants screen is built. */
const navigation = [
  { to: '/programmes', label: 'Programmes' },
  { to: '/submissions', label: 'Submissions' },
  { to: '/reviews/spread', label: 'Reviews' },
  { to: '/decisions', label: 'Decisions' },
  { to: '/insight', label: 'Insight' },
  { to: '/reports', label: 'Reports' },
  { to: '/organisations', label: 'Organisations' },
  { to: '/team', label: 'Team' },
  { to: '/audit', label: 'Audit log' },
  { to: '/settings', label: 'Settings' },
] as const;

/** A reviewer's console has one place to go: their own reviews. */
const reviewerNavigation = [{ to: '/reviews', label: 'My reviews' }] as const;

const previews: readonly RouteDefinition[] = [
  ...setupRoutes,
  ...reviewRoutes,
  ...decideRoutes,
  ...insightRoutes,
  ...settingsRoutes,
  ...accountRoutes,
];

/** Routes with a parameter stand in for many pages, so the index leaves them out. */
const indexed = previews.filter(({ path }) => !path.includes(':'));

/**
 * Two pages stand outside the staff shell: the signed-out screen, in the frame
 * of the console's sign-in screens, and the form as applicants see it. A static
 * host adds a trailing slash, so it is ignored.
 */
function PreviewShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const path = pathname.replace(/\/+$/, '');
  if (path === signedOutPath) return <AuthFrame>{children}</AuthFrame>;
  if (path === formPreviewPath) {
    return (
      <AppShell productName={productName} areaName="Form preview" density="comfortable">
        {children}
      </AppShell>
    );
  }
  const reviewing = isReviewerPath(pathname);
  return (
    <AppShell
      productName={productName}
      homeHref={reviewing ? '/reviews' : '/'}
      areaName={reviewing ? 'Reviewer' : 'Staff console'}
      navigation={
        <ul className="flex flex-wrap gap-1 md:flex-col">
          {(reviewing ? reviewerNavigation : navigation).map((item) => (
            <li key={item.to}>
              <Link to={item.to} section className={navLinkClassName}>
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      }
      actions={
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body">
          <span className="font-medium text-ink">{funder.name}</span>
          <span className="text-muted">{reviewing ? reviewer.email : staff.email}</span>
          <Button
            variant="quiet"
            onClick={() => {
              navigate(signedOutPath);
            }}
          >
            Sign out
          </Button>
        </p>
      }
    >
      {children}
    </AppShell>
  );
}

function PreviewIndex() {
  return (
    <div className="flex max-w-prose flex-col gap-stack">
      <PageHeading>Design previews</PageHeading>
      <p className="text-body text-muted">
        Screens still being built, on synthetic data. Nothing here reaches the API.
      </p>
      <ul className="flex flex-col gap-1">
        {indexed.map(({ path, title }) => (
          <li key={path}>
            <Link to={path}>{typeof title === 'string' ? title : path}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function PreviewApp() {
  return (
    <Router
      routes={[{ path: '/', title: 'Design previews', component: PreviewIndex }, ...previews]}
      basePath={
        import.meta.env.MODE === 'demo'
          ? import.meta.env.BASE_URL.replace(/\/$/, '')
          : '/dev/preview'
      }
      layout={PreviewShell}
      titleSuffix={titleSuffix}
    />
  );
}
