// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Route contracts and the apps' API client: the `/api` subpath of the domain package.

import '../jitless/index.ts';

export {
  isProjectedAnswersSchema,
  projectedAnswers,
  projectedAnswersSchemas,
  type ProjectedAnswers,
} from './answers/projection.ts';
export {
  apiBasePath,
  call,
  upload,
  type CallInput,
  type CallOptions,
  type CallResult,
  type Fetch,
  type UploadFile,
  type UploadInput,
  type UploadOptions,
  type UploadRequest,
  type UploadSignal,
} from './call.ts';
export { rawUploadRequestBody } from './json-schema.ts';
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
  type UploadRouteContract,
} from './route.ts';
export {
  isRawBody,
  rawContentTypes,
  rawUploadContentType,
  type RawBody,
  type RawContentType,
  type RawUploadBody,
  type RequestBody,
  type ResponseBody,
} from './schema-rules.ts';
