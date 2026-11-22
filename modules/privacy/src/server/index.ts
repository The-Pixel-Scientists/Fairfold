// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The privacy module's server entry point (ADR 0016). `privacyHandlers` is
// for apps/api/src/modules.ts alone, which registers the routes. Its
// `replay*` functions answer a replayed idempotent request without a second
// view event. `privacySubjectRules` is for the platform's audit writer alone.
// `privacyErasure` serves erasure. Subject access (`privacySubjectData`) is not
// exported yet: it runs as app_worker, which cannot read the columns it lists.

import { breachHandlers } from './breaches/handlers.ts';
import type { PrivacyDependencies } from './context.ts';
import { dpiaHandlers } from './dpias/handlers.ts';
import { clockHandlers } from './requests/clock.ts';
import { requestHandlers } from './requests/handlers.ts';
import { taskHandlers } from './requests/tasks.ts';

export type { PrivacyContext, PrivacyDependencies } from './context.ts';
export { privacySubjectRules } from './audit.ts';
export { privacyErasure } from './erasure.ts';

export function privacyHandlers(deps: PrivacyDependencies) {
  return {
    ...requestHandlers(deps),
    ...clockHandlers(deps),
    ...taskHandlers(deps),
    ...breachHandlers(deps),
    ...dpiaHandlers(deps),
  };
}
