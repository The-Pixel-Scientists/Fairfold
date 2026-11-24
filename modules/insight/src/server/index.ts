// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The insight module's server entry point (ADR 0016). `insightHandlers` is
// for apps/api/src/modules/insight.ts alone, which registers the routes and
// passes in grants' `monitoringCounts` and the warehouse's rows. Equality
// monitoring runs go through the run log (ADR 0032, rule 7). `regulatoryHandlers` serves the
// publication run routes and `preparePublication` the worker's preparation job.

import { dataContractList } from '../contracts/index.ts';
import type { InsightDependencies } from './context.ts';
import { definitionHandlers } from './definitions.ts';
import { disclosureHandlers } from './disclosure.ts';
import { monitoringHandlers } from './monitoring.ts';
import { reportHandlers } from './reports.ts';

export type {
  InsightContext,
  InsightDependencies,
  MonitoringCounts,
  WarehouseRead,
  WarehouseRow,
} from './context.ts';
export {
  preparePublication,
  regulatoryHandlers,
  type PreparationDependencies,
  type PrepareJob,
  type PublicationSources,
  type Requester,
  type RunDependencies,
} from './regulatory/index.ts';

export function insightHandlers(deps: InsightDependencies) {
  return {
    ...definitionHandlers(deps),
    ...disclosureHandlers(deps),
    ...monitoringHandlers(deps),
    ...reportHandlers(deps),
    // The registry holds no tenant data.
    listDataContracts: () => Promise.resolve(dataContractList()),
  };
}
