// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Route contracts and the apps' API client: the `/api` subpath of the domain package.

import '../jitless/index.ts';

export {
  apiBasePath,
  call,
  type CallInput,
  type CallOptions,
  type CallResult,
  type Fetch,
} from './call.ts';
export { fieldProblemSchema, ProblemError, problemSchema, type Problem } from './problem.ts';
export { authSessions, type AuthSession } from './access-rules.ts';
export {
  audiences,
  checkRoute,
  defineRoute,
  methods,
  type Audience,
  type JsonRouteContract,
  type Method,
  type RouteContract,
} from './route.ts';
export {
  isRawBody,
  rawContentTypes,
  type RawBody,
  type RawContentType,
  type ResponseBody,
} from './schema-rules.ts';
