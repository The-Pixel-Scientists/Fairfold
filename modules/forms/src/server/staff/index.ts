// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The staff routes' handlers: forms, drafts, versions and templates.

import type { StaffDependencies } from './context.ts';
import { formHandlers } from './forms.ts';
import { templateHandlers } from './templates.ts';
import { versionHandlers } from './versions.ts';

export type { StaffContext, StaffDependencies, StaffStore } from './context.ts';
export type { DraftRow, FormRow, VersionRow } from './context.ts';

export function staffHandlers<Tx>(deps: StaffDependencies<Tx>) {
  return { ...formHandlers(deps), ...versionHandlers(deps), ...templateHandlers(deps) };
}
