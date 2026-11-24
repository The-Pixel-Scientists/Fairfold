// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The crm module's server entry point (ADR 0016, ADR 0017). `crmHandlers` is
// for apps/api/src/modules.ts alone, which registers the routes against the
// contracts. `crmRepoint` is crm's entry in the party re-point registry, and
// is registered whether or not a tenant has crm on. `crmSubjectData` and
// `crmErasure` serve subject access and erasure. `CrmDependencies.parties` is
// what crm reads of party's records, supplied over party's server contract.
// `crmImportHandlers` are the CSV import routes, and `crmImportParser` the
// worker's parse job for them. `crmTimelineEvents` is the worker's handler for
// crm's event queue. The platform wraps both in their queues and sends the
// parse job; neither is a timer. Only the merge routes reach party's merge
// executor, and nothing here rejects, awards, pays or merges on its own
// (architecture rule 9).

import type { CrmDependencies } from './context.ts';
import { duplicateHandlers } from './duplicates.ts';
import { listHandlers } from './lists.ts';
import { mergeHandlers } from './merge.ts';
import { recordHandlers } from './records.ts';
import { referenceHandlers } from './references.ts';
import { searchHandlers } from './search.ts';
import { segmentHandlers } from './segments.ts';
import { timelineHandlers } from './timeline/read.ts';

export type { CrmContext, CrmDependencies } from './context.ts';
export { crmErasure } from './erasure.ts';
export { crmRepoint } from './repoint.ts';
export {
  importHandlers as crmImportHandlers,
  importParser as crmImportParser,
  type ImportDependencies,
  type NewParty,
  type ParseOutcome,
} from './import/index.ts';
export type { PartyReads } from './parties.ts';
export { crmSubjectData } from './subject-data.ts';
export {
  timelineEvents as crmTimelineEvents,
  type EventOutcome,
  type GrantsReads,
  type TimelineEventDependencies,
} from './timeline/events.ts';

export function crmHandlers(deps: CrmDependencies) {
  return {
    ...searchHandlers(deps),
    ...recordHandlers(deps),
    ...duplicateHandlers(deps),
    ...mergeHandlers(deps),
    ...referenceHandlers(deps),
    ...listHandlers(deps),
    ...segmentHandlers(deps),
    ...timelineHandlers(deps),
  };
}
