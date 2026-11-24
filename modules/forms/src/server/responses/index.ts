// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The response routes' handlers, for staff and for signed-in respondents.

import type { ResponseDependencies } from './context.ts';
import { portalResolvers, portalResponseHandlers } from './portal.ts';
import { staffResponseHandlers } from './staff.ts';

export type {
  After,
  DetailRow,
  DraftRow,
  Filters,
  OpenForm,
  OwnDetail,
  OwnSummary,
  Receipt,
  ResponseContext,
  ResponseDependencies,
  ResponseStore,
  SignedInVersion,
  SummaryRow,
  Totals,
} from './context.ts';

export function responseHandlers<Tx>(deps: ResponseDependencies<Tx>) {
  return { ...staffResponseHandlers(deps), ...portalResponseHandlers(deps) };
}

export { portalResolvers as formsResolvers };
