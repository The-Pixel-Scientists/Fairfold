// SPDX-License-Identifier: AGPL-3.0-or-later

import { createContext, useContext, useMemo } from 'react';
import type { ComponentType } from 'react';

import { searchToRecord } from './paths.ts';
import type { Params } from './paths.ts';

/** A page is a component with no props: it reads what it needs through the hooks. */
export type PageModule = { default: ComponentType };

/** How a route supplies its page: loaded on demand, or already in the bundle. */
export type RoutePage =
  | { load: () => Promise<PageModule>; component?: never }
  | { component: ComponentType; load?: never };

/**
 * A page title that comes from the address can put anyone's words in the
 * document title, so a title function needs a `params` schema, and gets only
 * what the schema accepted.
 */
type RouteTitle =
  | {
      /** The page title. It becomes the document title. */
      title: string;
      /** Checks the path parameters. A route whose parameters fail does not match. */
      params?: SearchSchema<Params>;
    }
  | {
      /** The page title, built from the checked path parameters. */
      title: (params: Params) => string;
      params: SearchSchema<Params>;
    };

export type RouteDefinition = {
  /** A path pattern such as `/applications/:id`. */
  path: string;
} & RouteTitle &
  RoutePage;

/** A page the router shows on its own: for an unknown address, or when a page fails to load. */
export type PageDefinition = { title: string } & RoutePage;

export type NotFoundDefinition = PageDefinition;

/** The address inside the app: the path after the base path, the search string and the hash. */
export interface RouterLocation {
  pathname: string;
  search: string;
  hash: string;
}

export interface NavigateOptions {
  /** Replace the current history entry instead of adding one. */
  replace?: boolean;
}

/** Go to a path inside the app. Throws InvalidAppPathError for anything else. */
export type NavigateFunction = (to: string, options?: NavigateOptions) => void;

export interface LeaveGuard {
  /** The question asked before leaving. */
  message: string;
}

export interface RouterContextValue {
  basePath: string;
  location: RouterLocation;
  params: Params;
  navigate: NavigateFunction;
  registerGuard: (guard: LeaveGuard) => () => void;
}

export const RouterContext = createContext<RouterContextValue | null>(null);

export function useRouterContext(hookName: string): RouterContextValue {
  const value = useContext(RouterContext);
  if (!value) throw new Error(`${hookName} must be used inside a Router.`);
  return value;
}

/** Returns a function that goes to a path inside the app. */
export function useNavigate(): NavigateFunction {
  return useRouterContext('useNavigate').navigate;
}

/** The address inside the app: the path after the base path, the search string and the hash. */
export function useLocation(): RouterLocation {
  return useRouterContext('useLocation').location;
}

/** The parameters of the matched route, such as `id` for `/applications/:id`, as its `params` schema accepted them. */
export function useParams(): Params {
  return useRouterContext('useParams').params;
}

export type SearchResult<T> = { success: true; data: T } | { success: false; error: unknown };

/** Anything with Zod's `safeParse`, so packages/ui needs no dependency on Zod. */
export interface SearchSchema<T> {
  safeParse: (input: unknown) => SearchResult<T>;
}

/**
 * The search string, parsed through a schema. A key that appears once is a
 * string and a key that repeats is an array of strings. Returns the schema's
 * own result, so the page decides what to show for an address someone edited
 * by hand. Define the schema once at module level.
 */
export function useSearch<T>(schema: SearchSchema<T>): SearchResult<T> {
  const { location } = useRouterContext('useSearch');
  const search = location.search;
  return useMemo(() => schema.safeParse(searchToRecord(search)), [schema, search]);
}
