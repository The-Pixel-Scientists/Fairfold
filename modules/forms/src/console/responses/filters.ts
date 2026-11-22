// SPDX-License-Identifier: AGPL-3.0-or-later

import type { responseViews, ResponseRoute } from '../../contracts/index.ts';
import { fromUkInput } from '../format.ts';

/** What a list of responses is narrowed by. Empty text means no filter. Held in memory, never in an address. */
export interface Filters {
  view: (typeof responseViews)[number];
  route: '' | ResponseRoute;
  versionId: string;
  /** A day in UK time, `2027-02-02`. */
  from: string;
  to: string;
}

export const noFilters: Filters = { view: 'received', route: '', versionId: '', from: '', to: '' };

/** The filters of a query the API takes, without the view: days become UK-time moments sent as UTC; a day that is not one is dropped. */
export function queryOf({ route, versionId, from, to }: Filters) {
  const submittedFrom = from === '' ? null : fromUkInput(`${from}T00:00`);
  const submittedTo = to === '' ? null : fromUkInput(`${to}T23:59:59`);
  return {
    ...(route === '' ? {} : { route }),
    ...(versionId === '' ? {} : { formVersionId: versionId }),
    ...(submittedFrom === null ? {} : { submittedFrom }),
    ...(submittedTo === null ? {} : { submittedTo }),
  };
}
