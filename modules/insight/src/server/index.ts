// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The insight module's server entry point (ADR 0016). `insightHandlers` is
// for apps/api/src/modules.ts alone, which registers the routes and passes in
// grants' `monitoringCounts`. Equality monitoring runs are not registered
// until the run log exists (ADR 0032, rule 7).

import { dataContractList } from '../contracts/index.ts';
import type { InsightDependencies } from './context.ts';
import { definitionHandlers } from './definitions.ts';
import { disclosureHandlers } from './disclosure.ts';
import { monitoringHandlers } from './monitoring.ts';

export type { InsightContext, InsightDependencies, MonitoringCounts } from './context.ts';

export function insightHandlers(deps: InsightDependencies) {
  return {
    ...definitionHandlers(deps),
    ...disclosureHandlers(deps),
    ...monitoringHandlers(deps),
    // The registry holds no tenant data.
    listDataContracts: () => Promise.resolve(dataContractList()),
  };
}
