// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The erasure routes and job (ADR 0027), matched with their contracts.

import type { JobSender } from '@pixel-scientists/db/jobs';
import {
  readErasureRequest,
  requestErasure,
} from '@pixel-scientists/domain/platform/subject-access';

import { route, type Route } from '../../routes/register.ts';
import {
  readErasureRequestHandler,
  replayErasureRequest,
  requestErasureHandler,
} from './request.ts';

export const erasureRoutes = (jobs: JobSender): readonly Route[] => [
  route(requestErasure, requestErasureHandler(jobs), { replay: replayErasureRequest }),
  route(readErasureRequest, readErasureRequestHandler),
];

export { erasureJob, erasureQueue, type ErasureDependencies } from './job.ts';
export { runErasure, type Contribution } from './registry.ts';
