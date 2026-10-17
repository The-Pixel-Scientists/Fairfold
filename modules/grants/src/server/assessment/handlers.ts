// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The assessment routes' handlers (ADR 0004), matched with their contracts
// in apps/api/src/modules.ts.

import { assignmentHandlers } from './assignments.ts';
import { automaticHandlers } from './automatic.ts';
import type { AssessmentDependencies } from './context.ts';
import { poolHandlers } from './pool.ts';
import { reviewHandlers } from './reviews.ts';
import { spreadHandlers } from './spread.ts';

export function assessmentHandlers(deps: AssessmentDependencies) {
  return {
    ...poolHandlers(deps),
    ...assignmentHandlers(deps),
    ...automaticHandlers(deps),
    ...spreadHandlers(deps),
    ...reviewHandlers(deps),
  };
}
