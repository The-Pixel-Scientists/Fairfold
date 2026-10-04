// SPDX-License-Identifier: AGPL-3.0-or-later

import { AppShell, NotFoundPage, Router, SessionProvider } from '@pixel-scientists/ui';
import type { PageDefinition, RouteDefinition } from '@pixel-scientists/ui';
import type { ReactNode } from 'react';

import { endSession, loadSession } from './api.ts';
import CheckEmailPage from './auth/CheckEmailPage.tsx';
import CompleteSignUpPage from './auth/CompleteSignUpPage.tsx';
import EnterCodePage from './auth/EnterCodePage.tsx';
import ForgotPasswordPage from './auth/ForgotPasswordPage.tsx';
import ForgotPasswordSentPage from './auth/ForgotPasswordSentPage.tsx';
import ResetPasswordPage from './auth/ResetPasswordPage.tsx';
import { Screen } from './auth/Screen.tsx';
import SetUpAuthenticatorPage from './auth/SetUpAuthenticatorPage.tsx';
import SignedOutPage from './auth/SignedOutPage.tsx';
import SignInPage from './auth/SignInPage.tsx';
import SignUpPage from './auth/SignUpPage.tsx';
import { TenantLook } from './platform/settings/look.tsx';
import { productName, titleSuffix } from './product.ts';
import { TenantProvider, tenantSlugOf } from './tenant.ts';

/**
 * Pages outside any funder's address. The first segment of each path must be
 * in `reservedSlugs`, or a funder could take the slug and shadow the page.
 */
export const topLevelRoutes: readonly RouteDefinition[] = [
  { path: '/', title: "Use your funder's link", load: () => import('./pages/NoFunderPage.tsx') },
  // The component gallery is for development builds only. The production build drops it.
  ...(import.meta.env.DEV
    ? [
        {
          path: '/dev/components',
          title: 'Component gallery',
          load: () => import('./pages/ComponentGalleryPage.tsx'),
        },
      ]
    : []),
];

/** Pages under `/<slug>/`, which the router sees without the slug. */
export const tenantRoutes: readonly RouteDefinition[] = [
  { path: '/', title: 'Programmes', load: () => import('./pages/ProgrammesPage.tsx') },
  {
    path: '/settings',
    title: 'General settings',
    load: () => import('./platform/settings/GeneralPage.tsx'),
  },
  {
    path: '/settings/look',
    title: 'Look and logo',
    load: () => import('./platform/settings/LookPage.tsx'),
  },
  {
    path: '/settings/modules',
    title: 'Modules',
    load: () => import('./platform/settings/ModulesPage.tsx'),
  },
  { path: '/sign-in', title: 'Sign in', component: SignInPage },
  { path: '/sign-up', title: 'Create your account', component: SignUpPage },
  { path: '/sign-up/check-email', title: 'Check your email', component: CheckEmailPage },
  { path: '/sign-up/complete', title: 'Set your password', component: CompleteSignUpPage },
  { path: '/forgot-password', title: 'Reset your password', component: ForgotPasswordPage },
  {
    path: '/forgot-password/sent',
    title: 'Check your email',
    component: ForgotPasswordSentPage,
  },
  { path: '/reset-password', title: 'Choose a new password', component: ResetPasswordPage },
  { path: '/signed-out', title: 'You have signed out', component: SignedOutPage },
  {
    path: '/set-up-authenticator',
    title: 'Set up your authenticator app',
    component: SetUpAuthenticatorPage,
  },
  { path: '/enter-code', title: 'Enter your code', component: EnterCodePage },
];

function TenantNotFound() {
  return (
    <Screen kind="member">
      <NotFoundPage />
    </Screen>
  );
}

const tenantNotFound: PageDefinition = { title: 'Page not found', component: TenantNotFound };

function TopLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell productName={productName} areaName="Staff console">
      {children}
    </AppShell>
  );
}

function TenantLayout({ children }: { children: ReactNode }) {
  return (
    <TenantLook>
      <SessionProvider load={loadSession} signOut={endSession}>
        {children}
      </SessionProvider>
    </TenantLook>
  );
}

/**
 * The first segment of the address picks the app: a funder's slug opens that
 * funder's console, with the router under `/<slug>`; anything else is one of
 * the few pages outside a funder. A page load keeps one slug, and switching
 * funder opens the new address afresh.
 */
export function App() {
  const slug = tenantSlugOf(window.location.pathname);
  if (slug === null) {
    return <Router routes={topLevelRoutes} layout={TopLayout} titleSuffix={titleSuffix} />;
  }
  return (
    <TenantProvider value={slug}>
      <Router
        routes={tenantRoutes}
        notFound={tenantNotFound}
        basePath={`/${slug}`}
        layout={TenantLayout}
        titleSuffix={titleSuffix}
      />
    </TenantProvider>
  );
}
