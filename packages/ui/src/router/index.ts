// SPDX-License-Identifier: AGPL-3.0-or-later

export { NotFoundPage } from './pages.tsx';
export { Router } from './Router.tsx';
export type { RouterProps } from './Router.tsx';
export { Link } from './Link.tsx';
export type { LinkProps } from './Link.tsx';
export { RouteAnnouncer } from './RouteAnnouncer.tsx';
export type { RouteAnnouncerProps } from './RouteAnnouncer.tsx';
export { DEFAULT_LEAVE_MESSAGE, useLeaveGuard } from './useLeaveGuard.ts';
export { useLocation, useNavigate, useParams, useSearch } from './context.ts';
export type {
  NavigateFunction,
  NavigateOptions,
  NotFoundDefinition,
  PageDefinition,
  PageModule,
  RouteDefinition,
  RouterLocation,
  RoutePage,
  SearchResult,
  SearchSchema,
} from './context.ts';
export { InvalidAppPathError, isAppPath } from './paths.ts';
export type { Params } from './paths.ts';
