// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Duplicate flags (ADR 0025, ADR 0031). `duplicateHandlers` is for
// apps/api/src/modules.ts alone, which registers the read routes and passes
// in party's contract and what grants says of an application.

export {
  duplicateHandlers,
  flagId,
  type DuplicateContext,
  type DuplicateDependencies,
} from './flags.ts';
