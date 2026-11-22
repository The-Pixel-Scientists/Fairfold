// SPDX-License-Identifier: AGPL-3.0-or-later
//
// crm's CSV import (ADR 0025): the four routes, and the parse job the
// platform queues for each started import.

import type { CrmDependencies } from '../context.ts';
import { confirmHandlers } from './confirm.ts';
import type { ImportDependencies } from './context.ts';
import { previewHandlers } from './preview.ts';
import { startHandlers } from './start.ts';

export type { ImportDependencies, NewParty } from './context.ts';
export { importParser, type ParseOutcome } from './parse.ts';
export type { PersonImportInput } from './rows.ts';

export function importHandlers(deps: CrmDependencies, imports: ImportDependencies) {
  return {
    ...startHandlers(deps, imports),
    ...previewHandlers(deps, imports),
    ...confirmHandlers(deps, imports),
  };
}
