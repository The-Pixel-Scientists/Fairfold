// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A small history router (ADR 0014). It matches the address against a route
// table, shows the page, and does the accessibility work a route change needs.

import {
  Suspense,
  createElement,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import type { ComponentType, ReactNode } from 'react';

import { Button } from '../Button.tsx';
import { Dialog } from '../dialog/index.ts';
import { focusElement, scrollBehavior } from '../focus.ts';
import { LoadingState } from '../LoadingState.tsx';
import { RouterContext } from './context.ts';
import type {
  LeaveGuard,
  NavigateFunction,
  PageDefinition,
  RouteDefinition,
  RouterContextValue,
  RouterLocation,
  RoutePage,
} from './context.ts';
import { readHistoryIndex, withHistoryIndex } from './history.ts';
import { NotFoundPage, RouteErrorBoundary, RouteErrorPage } from './pages.tsx';
import { matchPath, normalizeBasePath, resolveAppPath } from './paths.ts';
import type { Params } from './paths.ts';
import { RouteAnnouncer } from './RouteAnnouncer.tsx';

const defaultNotFound: PageDefinition = { title: 'Page not found', component: NotFoundPage };
const defaultErrorPage: PageDefinition = {
  title: 'This page did not load',
  component: RouteErrorPage,
};

/** A page still loading after this long gets a visible "Loading" line and an announcement. */
const SLOW_LOAD_MS = 400;

export interface RouterProps {
  /** Every page. Define the table once, at module level, so pages are not reloaded on each render. */
  routes: readonly RouteDefinition[];
  /** Shown for an address no route matches. Defaults to a plain "Page not found" page. */
  notFound?: PageDefinition;
  /**
   * Shown when a page fails to load. The default is written for staff: it says
   * to reload, then to tell an administrator. Set your own for other readers.
   */
  errorPage?: PageDefinition;
  /**
   * Where the app lives when one host serves several, such as `/console`.
   * Leave it out for an app served from the root.
   */
  basePath?: string;
  /** Added after each page title in the document title, for example "Fairfold Grants console". */
  titleSuffix?: string;
  /**
   * The frame around the page, such as AppShell. Define it at module level.
   * Links and hooks work inside it.
   */
  layout?: ComponentType<{ children: ReactNode }>;
  /** Shown while a page loads for the first time. Defaults to LoadingState. */
  loading?: ReactNode;
}

interface RouterState {
  location: RouterLocation;
  /** False when the browser's address is outside the base path, which no route can match. */
  inBase: boolean;
  announcement: { id: number; text: string };
  /** True while the error page stands in for a page that failed. */
  failed: boolean;
}

interface ResolvedPage {
  page: RoutePage;
  params: Params;
  title: string;
  /** Changes when the page changes, but not when only the search string or hash does. */
  key: string;
}

function Passthrough({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

const lazyPages = new WeakMap<object, ComponentType>();
/** Pages whose load failed. They are forgotten on the next navigation, so going there again retries. */
const failedLoads = new Set<object>();

/** The component for a route, loaded on demand and kept. */
function componentFor(page: RoutePage): ComponentType {
  if (page.component) return page.component;
  const { load } = page;
  let component = lazyPages.get(load);
  if (!component) {
    component = lazy(() =>
      load().catch((error: unknown) => {
        failedLoads.add(load);
        throw error;
      }),
    );
    lazyPages.set(load, component);
  }
  return component;
}

function forgetFailedLoads(): void {
  for (const load of failedLoads) lazyPages.delete(load);
  failedLoads.clear();
}

function canonicalPath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

/** The browser's address, less the base path. */
function readLocation(base: string): Pick<RouterState, 'location' | 'inBase'> {
  const { pathname, search, hash } = window.location;
  if (base === '') return { location: { pathname, search, hash }, inBase: true };
  if (pathname === base || pathname.startsWith(`${base}/`)) {
    return {
      location: { pathname: pathname.slice(base.length) || '/', search, hash },
      inBase: true,
    };
  }
  return { location: { pathname, search, hash }, inBase: false };
}

function resolvePage(
  routes: readonly RouteDefinition[],
  notFound: PageDefinition,
  state: Pick<RouterState, 'location' | 'inBase'>,
): ResolvedPage {
  let found: { route: RouteDefinition; params: Params } | null = null;
  if (state.inBase) {
    for (const route of routes) {
      const matched = matchPath(route.path, state.location.pathname);
      if (!matched) continue;
      const checked = route.params
        ? route.params.safeParse(matched)
        : { success: true, data: matched };
      if (checked.success) {
        found = { route, params: checked.data };
        break;
      }
    }
  }
  const params = found?.params ?? {};
  const title =
    found === null
      ? notFound.title
      : typeof found.route.title === 'function'
        ? found.route.title(params)
        : found.route.title;
  return {
    page: found?.route ?? notFound,
    params,
    title,
    key: `${found ? found.route.path : 'not-found'}:${canonicalPath(state.location.pathname)}`,
  };
}

/** True once `active` has stayed true for `delay` milliseconds. */
function useAfterDelay(active: boolean, delay: number): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!active) return undefined;
    const timer = setTimeout(() => {
      setElapsed(true);
    }, delay);
    return () => {
      clearTimeout(timer);
      setElapsed(false);
    };
  }, [active, delay]);
  return active && elapsed;
}

/** A way out of a page with unsaved changes that is waiting for the person's answer. */
interface LeaveRequest {
  /** What the page being left says is at risk. */
  message: string;
  /** Carries on to where the person was going. */
  proceed: () => void;
}

/**
 * Show the page for the browser's address and keep it in step with the back
 * and forward buttons.
 *
 * After each change of page, Router sets the document title, moves focus to
 * the page's `h1` and announces "Navigated to" and the title. A new page
 * starts at the top (instantly when the person prefers reduced motion); back
 * and forward return to where the person was and take focus without
 * scrolling. A page slow to load shows and announces "Loading". A page that
 * fails to load gets the title, announcement and focus of the error page. The
 * first page load keeps the browser's own focus. Changing only the search
 * string or the hash does none of this, so filters keep focus where it is.
 *
 * A page with unsaved changes (useLeaveGuard) gets a dialog before it is left,
 * whether by a link, the back and forward buttons or a redirect.
 */
export function Router({
  routes,
  notFound = defaultNotFound,
  errorPage = defaultErrorPage,
  basePath = '',
  titleSuffix,
  layout: Layout = Passthrough,
  loading,
}: RouterProps) {
  const base = normalizeBasePath(basePath);
  const [state, setState] = useState<RouterState>(() => ({
    ...readLocation(base),
    announcement: { id: 0, text: '' },
    failed: false,
  }));
  const [isPending, startTransition] = useTransition();
  const [pendingTitle, setPendingTitle] = useState('');
  const showPending = useAfterDelay(isPending, SLOW_LOAD_MS);

  const resolved = useMemo(() => resolvePage(routes, notFound, state), [routes, notFound, state]);
  const title = state.failed ? errorPage.title : resolved.title;

  const outlet = useRef<HTMLDivElement>(null);
  const guards = useRef(new Set<LeaveGuard>());
  const historyIndex = useRef(0);
  const ignoreNextPop = useRef(false);
  /** Set while a back or forward the person has agreed to is replayed, so it is not asked about twice. */
  const agreedPop = useRef(false);
  const [leaving, setLeaving] = useState<LeaveRequest | null>(null);
  const scrollPositions = useRef(new Map<number, number>());
  const scrollOnArrival = useRef<number | null>(null);
  const current = useRef({ pathname: state.location.pathname, inBase: state.inBase });
  useEffect(() => {
    current.current = { pathname: state.location.pathname, inBase: state.inBase };
  }, [state.location.pathname, state.inBase]);

  // Number this entry, so a declined back or forward can be undone.
  useEffect(() => {
    const index = readHistoryIndex(window.history.state) ?? 0;
    historyIndex.current = index;
    const existing: unknown = window.history.state;
    window.history.replaceState(withHistoryIndex(existing, index), '');
  }, []);

  // The router restores scroll itself: the browser would do it before a lazy page has rendered.
  useEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => {
      window.history.scrollRestoration = previous;
    };
  }, []);

  const registerGuard = useCallback((guard: LeaveGuard) => {
    guards.current.add(guard);
    return () => {
      guards.current.delete(guard);
    };
  }, []);

  /** Carries on at once when no page is guarding against it, and otherwise once the person agrees to leave. */
  const confirmLeave = useCallback((proceed: () => void) => {
    const [first] = guards.current;
    if (first === undefined) proceed();
    else setLeaving({ message: first.message, proceed });
  }, []);

  const showLocation = useCallback(
    (next: Pick<RouterState, 'location' | 'inBase'>) => {
      forgetFailedLoads();
      const nextTitle = resolvePage(routes, notFound, next).title;
      setPendingTitle(nextTitle);
      startTransition(() => {
        setState((previous) => {
          const samePage =
            previous.inBase === next.inBase &&
            canonicalPath(previous.location.pathname) === canonicalPath(next.location.pathname);
          if (samePage) return { ...previous, ...next };
          return {
            ...next,
            failed: false,
            announcement: { id: previous.announcement.id + 1, text: `Navigated to ${nextTitle}` },
          };
        });
      });
    },
    [routes, notFound],
  );

  /** Called by the error boundary: the error page is now what the person sees. */
  const showError = useCallback(() => {
    setState((previous) =>
      previous.failed
        ? previous
        : {
            ...previous,
            failed: true,
            announcement: { id: previous.announcement.id + 1, text: errorPage.title },
          },
    );
  }, [errorPage.title]);

  const navigate = useCallback<NavigateFunction>(
    (to, options) => {
      const { location: next, href } = resolveAppPath(base, to);

      const go = () => {
        const { pathname, search, hash } = window.location;
        const replace = options?.replace === true || href === `${pathname}${search}${hash}`;
        const index = replace ? historyIndex.current : historyIndex.current + 1;
        const existing: unknown = window.history.state;
        const entry = withHistoryIndex(existing, index);
        scrollPositions.current.set(historyIndex.current, window.scrollY);
        if (replace) window.history.replaceState(entry, '', href);
        else window.history.pushState(entry, '', href);
        historyIndex.current = index;
        scrollOnArrival.current = null;
        showLocation({ location: next, inBase: true });
      };

      const here = current.current;
      const leavingPage =
        !here.inBase || canonicalPath(here.pathname) !== canonicalPath(next.pathname);
      if (leavingPage) confirmLeave(go);
      else go();
    },
    [base, confirmLeave, showLocation],
  );

  // Back and forward.
  useEffect(() => {
    function handlePopState(event: PopStateEvent) {
      if (ignoreNextPop.current) {
        ignoreNextPop.current = false;
        return;
      }
      const next = readLocation(base);
      const here = current.current;
      const leavingPage =
        here.inBase !== next.inBase ||
        canonicalPath(here.pathname) !== canonicalPath(next.location.pathname);
      const index = readHistoryIndex(event.state);
      const agreed = agreedPop.current;
      agreedPop.current = false;

      const arrive = () => {
        // The window is still scrolled as the page being left had it.
        scrollPositions.current.set(historyIndex.current, window.scrollY);
        if (index !== null) historyIndex.current = index;
        scrollOnArrival.current = leavingPage
          ? (scrollPositions.current.get(historyIndex.current) ?? 0)
          : null;
        showLocation(next);
      };

      if (!leavingPage || agreed || guards.current.size === 0) {
        arrive();
        return;
      }
      if (index === null || index === historyIndex.current) {
        confirmLeave(arrive);
        return;
      }
      // The browser has already moved; step back to where the person was, and ask.
      const steps = index - historyIndex.current;
      ignoreNextPop.current = true;
      window.history.go(-steps);
      confirmLeave(() => {
        agreedPop.current = true;
        window.history.go(steps);
      });
    }
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [base, confirmLeave, showLocation]);

  // The document title follows the page, including on the first load.
  const documentTitle = titleSuffix ? `${title} – ${titleSuffix}` : title;
  useEffect(() => {
    document.title = documentTitle;
  }, [documentTitle]);

  // After a change of page: the top, or where the person was going back or forward; then the h1.
  const announcementId = state.announcement.id;
  useEffect(() => {
    if (announcementId === 0) return;
    const restoreTo = scrollOnArrival.current;
    scrollOnArrival.current = null;
    window.scrollTo({ top: restoreTo ?? 0, left: 0, behavior: scrollBehavior() });
    const container = outlet.current;
    if (!container) return;
    const options = restoreTo === null ? undefined : { preventScroll: true };
    focusElement(container.querySelector('h1') ?? container, options);
  }, [announcementId]);

  const context = useMemo<RouterContextValue>(
    () => ({
      basePath: base,
      location: state.location,
      params: resolved.params,
      navigate,
      registerGuard,
    }),
    [base, state.location, resolved.params, navigate, registerGuard],
  );

  const loadingMessage = `Loading ${pendingTitle}…`;

  return (
    <RouterContext.Provider value={context}>
      <Layout>
        <div ref={outlet} aria-busy={isPending ? true : undefined}>
          {showPending && (
            <p className="fixed top-2 left-1/2 z-40 max-w-[calc(100%-1rem)] -translate-x-1/2 rounded-md border border-edge bg-surface px-3 py-1 text-body text-ink shadow-raised">
              {loadingMessage}
            </p>
          )}
          <Suspense fallback={loading ?? <LoadingState label="Loading page" />}>
            <RouteErrorBoundary
              resetKey={resolved.key}
              onError={showError}
              fallback={createElement(componentFor(errorPage))}
            >
              {createElement(componentFor(resolved.page))}
            </RouteErrorBoundary>
          </Suspense>
        </div>
      </Layout>
      <RouteAnnouncer
        message={showPending ? loadingMessage : state.announcement.text}
        messageId={announcementId}
      />
      <Dialog
        open={leaving !== null}
        onOpenChange={(open) => {
          if (!open) setLeaving(null);
        }}
        title="Leave this page?"
        description={leaving?.message}
        actions={
          <>
            <Button
              variant="danger"
              onClick={() => {
                setLeaving(null);
                leaving?.proceed();
              }}
            >
              Leave and lose changes
            </Button>
            <Button
              variant="primary"
              data-autofocus
              onClick={() => {
                setLeaving(null);
              }}
            >
              Stay on this page
            </Button>
          </>
        }
      />
    </RouterContext.Provider>
  );
}
