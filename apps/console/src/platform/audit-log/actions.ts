// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The action and entity codes the filters offer, from the modules' closed
// lists, each by the module its code starts with.

import { auditEntityType, platformAuditActions } from '@pixel-scientists/domain/platform';
import type { AuditAction } from '@pixel-scientists/domain/platform';
import { auditActionLabel } from '@pixel-scientists/domain/platform/audit-log';
import { grantsAuditActions } from '@pixel-scientists/grants/contracts';

import { entityLabel, moduleLabel } from './words.ts';

export interface Option {
  value: string;
  label: string;
}

const known: readonly AuditAction[] = [...platformAuditActions, ...grantsAuditActions];

const moduleOf = (code: string): string => code.split('.')[0] ?? '';

/** Options for a filter: the codes in `module` (every module when empty), plus `current` when it is not listed, as a hand-edited address can be. */
function options(
  codes: readonly string[],
  module: string,
  current: string,
  label: (code: string) => string,
): Option[] {
  const shown = [...new Set(codes)].filter((code) => module === '' || moduleOf(code) === module);
  if (current !== '' && !shown.includes(current)) shown.push(current);
  return shown
    .map((code) => ({ value: code, label: label(code) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export const actionOptions = (module: string, current: string): Option[] =>
  options(known, module, current, auditActionLabel);

export const entityTypeOptions = (module: string, current: string): Option[] =>
  options(
    known.map(auditEntityType),
    module,
    current,
    (code) => `${entityLabel(code)} (${moduleLabel(moduleOf(code))})`,
  );
