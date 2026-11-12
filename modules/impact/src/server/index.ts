// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The impact module's server entry point (ADR 0016). `impactHandlers` is
// for apps/api/src/modules.ts alone, which registers the routes.
// `impactSubjectRules` is for the platform's audit writer alone.

import type { ImpactDependencies } from './context.ts';
import { frameworkHandlers } from './frameworks.ts';
import { noteHandlers } from './notes.ts';
import { resultHandlers } from './results.ts';
import { summaryHandlers } from './summary.ts';
import { targetHandlers } from './targets.ts';

export type { ImpactContext, ImpactDependencies } from './context.ts';
export { impactSubjectRules } from './audit.ts';

export function impactHandlers(deps: ImpactDependencies) {
  return {
    ...frameworkHandlers(deps),
    ...targetHandlers(deps),
    ...resultHandlers(deps),
    ...noteHandlers(deps),
    ...summaryHandlers(deps),
  };
}
