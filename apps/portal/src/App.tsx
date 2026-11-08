// SPDX-License-Identifier: AGPL-3.0-or-later

import { idSchema } from '@pixel-scientists/domain';
import { NotFoundPage, Router, SessionProvider, useSession } from '@pixel-scientists/ui';
import type { PageDefinition, Params, RouteDefinition, SearchSchema } from '@pixel-scientists/ui';
import { Suspense, lazy, useMemo } from 'react';
import type { ReactNode } from 'react';

import { endSession, loadSession } from './api.ts';
import { applyRoutes } from './apply/routes.ts';
import AccountPage from './account/AccountPage.tsx';
import EmailChangePage from './account/EmailChangePage.tsx';
import CheckEmailPage from './auth/CheckEmailPage.tsx';
import CompleteSignUpPage from './auth/CompleteSignUpPage.tsx';
import ForgotPasswordPage from './auth/ForgotPasswordPage.tsx';
import ForgotPasswordSentPage from './auth/ForgotPasswordSentPage.tsx';
import ResetPasswordPage from './auth/ResetPasswordPage.tsx';
import { Screen } from './auth/Screen.tsx';
import SignedOutPage from './auth/SignedOutPage.tsx';
import SignInPage from './auth/SignInPage.tsx';
import SignUpPage from './auth/SignUpPage.tsx';
import { FunderProvider, useFunder } from './funder.tsx';
import { PageColumn } from './PageColumn.tsx';
import { pageLoadErrorPage } from './pages/PageLoadErrorPage.tsx';
import StartPage from './pages/StartPage.tsx';
import UnknownFunderPage from './pages/UnknownFunderPage.tsx';
import FutureFundingPage from './party/FutureFundingPage.tsx';
import OrganisationPage from './party/OrganisationPage.tsx';
import OrganisationsPage from './party/OrganisationsPage.tsx';
import ProfilePage from './party/ProfilePage.tsx';
import {
  ACCOUNT_PATH,
  ADD_ORGANISATION_PATH,
  CHECK_EMAIL_PATH,
  COMPLETE_SIGN_UP_PATH,
  EMAIL_CHANGE_PATH,
  FORGOT_PASSWORD_PATH,
  FUTURE_FUNDING_PATH,
  HOME_PATH,
  HOW_APPLYING_WORKS_PATH,
  ORGANISATIONS_PATH,
  ORGANISATION_PATH,
  PASSWORD_RESET_SENT_PATH,
  PROFILE_PATH,
  RESET_PASSWORD_PATH,
  SIGNED_OUT_PATH,
  SIGN_IN_PATH,
  SIGN_UP_PATH,
} from './paths.ts';
import { routesFor, toolRoutes } from './shell/gate.tsx';
import { grantsModule } from './shell/modules.ts';
import { PortalShell } from './shell/PortalShell.tsx';
import { productName } from './product.ts';
import { TenantProvider, tenantSlugOf } from './tenant.ts';

/**
 * Pages outside any funder's address. The first segment of each path must be
 * in `reservedSlugs`, or a funder could take the slug and shadow the page.
 */
export const topLevelRoutes: readonly RouteDefinition[] = [
  {
    path: HOME_PATH,
    title: "Use your funder's link",
    load: () => import('./pages/NoFunderPage.tsx'),
  },
  {
    path: HOW_APPLYING_WORKS_PATH,
    title: 'How applying works',
    load: () => import('./pages/HowApplyingWorksPage.tsx'),
  },
];

/** Only a real id is an organisation's address, so `/organisations/new` and typing mistakes never reach it. */
const organisationParams: SearchSchema<Params> = {
  safeParse: (input) =>
    idSchema.safeParse((input as Params)['organisationId']).success
      ? { success: true, data: input as Params }
      : { success: false, error: null },
};

/**
 * Pages under `/<slug>/`, which the router sees without the slug. They are in
 * the main bundle, not loaded on demand, so a weak connection cannot stop an
 * applicant at the door.
 */
const ownRoutes: readonly RouteDefinition[] = [
  { path: HOME_PATH, title: 'Apply for a grant', component: StartPage },
  { path: SIGN_UP_PATH, title: 'Create your account', component: SignUpPage },
  { path: CHECK_EMAIL_PATH, title: 'Check your email', component: CheckEmailPage },
  { path: COMPLETE_SIGN_UP_PATH, title: 'Set your password', component: CompleteSignUpPage },
  { path: SIGN_IN_PATH, title: 'Sign in', component: SignInPage },
  { path: FORGOT_PASSWORD_PATH, title: 'Reset your password', component: ForgotPasswordPage },
  {
    path: PASSWORD_RESET_SENT_PATH,
    title: 'Check your email',
    component: ForgotPasswordSentPage,
  },
  { path: RESET_PASSWORD_PATH, title: 'Choose a new password', component: ResetPasswordPage },
  { path: SIGNED_OUT_PATH, title: 'You have signed out', component: SignedOutPage },
  { path: ACCOUNT_PATH, title: 'Your account', component: AccountPage },
  { path: EMAIL_CHANGE_PATH, title: 'Confirm your new email address', component: EmailChangePage },
  { path: PROFILE_PATH, title: 'Your details', component: ProfilePage },
  { path: ORGANISATIONS_PATH, title: 'Your organisations', component: OrganisationsPage },
  { path: ADD_ORGANISATION_PATH, title: 'Add your organisation', component: OrganisationPage },
  {
    path: ORGANISATION_PATH,
    title: 'Change organisation details',
    params: organisationParams,
    component: OrganisationPage,
  },
  { path: FUTURE_FUNDING_PATH, title: 'Future funding', component: FutureFundingPage },
];

/** The tools whose pages come and go with the session. */
const tools = [toolRoutes(grantsModule, applyRoutes)];

function TenantNotFound() {
  return (
    <Screen kind="open">
      <PageColumn>
        <NotFoundPage />
      </PageColumn>
    </Screen>
  );
}

const tenantNotFound: PageDefinition = { title: 'Page not found', component: TenantNotFound };
const unknownFunder: PageDefinition = {
  title: 'We cannot find this funder',
  component: UnknownFunderPage,
};
/** A funder that does not exist has no pages. */
const noRoutes: readonly RouteDefinition[] = [];

function TopLayout({ children }: { children: ReactNode }) {
  return <PortalShell>{children}</PortalShell>;
}

/** What every router under a funder's address shares. */
const sharedProps = (slug: string) => ({
  errorPage: pageLoadErrorPage,
  basePath: `/${slug}`,
  titleSuffix: productName,
});

/** The funder's pages, less those of any tool the session does not show. */
function TenantRouter({ slug }: { slug: string }) {
  const { state } = useSession();
  const routes = useMemo(() => routesFor(state, ownRoutes, tools), [state]);
  return <Router routes={routes} notFound={tenantNotFound} {...sharedProps(slug)} />;
}

/** The funder's pages, or the one page that says the funder cannot be found. */
function FunderRouter({ slug }: { slug: string }) {
  const funder = useFunder();
  if (funder?.status === 'missing') {
    return (
      <Router
        key="missing"
        routes={noRoutes}
        notFound={unknownFunder}
        layout={TopLayout}
        {...sharedProps(slug)}
      />
    );
  }
  return (
    <SessionProvider load={loadSession} signOut={endSession}>
      <TenantRouter slug={slug} />
    </SessionProvider>
  );
}

/**
 * Design previews of screens not built yet: under /dev/preview in development,
 * and the whole app in a demo build (`vite build --mode demo`), which the
 * product site hosts. The production build drops them.
 */
const demo = import.meta.env.MODE === 'demo';
const PreviewApp =
  import.meta.env.DEV || demo ? lazy(() => import('./preview/PreviewApp.tsx')) : null;

/**
 * The first segment of the address picks the app: a funder's slug opens that
 * funder's portal, with the router under `/<slug>`; anything else is one of
 * the few pages outside a funder. A page load keeps one slug.
 */
export function App() {
  if (PreviewApp !== null && (demo || window.location.pathname.startsWith('/dev/preview'))) {
    return (
      <Suspense fallback={null}>
        <PreviewApp />
      </Suspense>
    );
  }
  const slug = tenantSlugOf(window.location.pathname);
  if (slug === null) {
    return (
      <Router
        routes={topLevelRoutes}
        layout={TopLayout}
        errorPage={pageLoadErrorPage}
        titleSuffix={productName}
      />
    );
  }
  return (
    <TenantProvider value={slug}>
      <FunderProvider>
        <FunderRouter slug={slug} />
      </FunderProvider>
    </TenantProvider>
  );
}
