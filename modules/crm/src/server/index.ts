// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The crm module's server entry point (ADR 0016, ADR 0017). `crmHandlers` is
// for apps/api/src/modules.ts alone, which registers the routes against the
// contracts. `crmRepoint` is crm's entry in the party re-point registry, and
// is registered whether or not a tenant has crm on. `crmSubjectData` and
// `crmErasure` serve subject access and erasure. `CrmDependencies.parties` is
// what crm reads of party's records, supplied over party's server contract.
// The module has no job, event handler or timer: only the merge routes reach
// party's merge executor (architecture rule 9).

import type { CrmDependencies } from './context.ts';
import { duplicateHandlers } from './duplicates.ts';
import { listHandlers } from './lists.ts';
import { mergeHandlers } from './merge.ts';
import { recordHandlers } from './records.ts';
import { searchHandlers } from './search.ts';
import { segmentHandlers } from './segments.ts';

export type { CrmContext, CrmDependencies } from './context.ts';
export { crmErasure } from './erasure.ts';
export { crmRepoint } from './repoint.ts';
export type { PartyReads } from './parties.ts';
export { crmSubjectData } from './subject-data.ts';

export function crmHandlers(deps: CrmDependencies) {
  return {
    ...searchHandlers(deps),
    ...recordHandlers(deps),
    ...duplicateHandlers(deps),
    ...mergeHandlers(deps),
    ...listHandlers(deps),
    ...segmentHandlers(deps),
  };
}
