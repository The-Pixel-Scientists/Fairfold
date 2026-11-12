// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The party the module's audit events are about (ADR 0027): none. A
// framework, a target, a result and a learning note are about the funder's
// work, and no impact table names a party. See the party module's audit.ts
// for the rules the platform applies.

import type { ImpactAuditAction } from '../contracts/index.ts';

/** The no-subject half of the party module's SubjectRule: the reason there is none. */
interface SubjectRule {
  readonly none: string;
}

const configuration: SubjectRule = { none: 'Outcomes framework or target configuration.' };
const aggregate: SubjectRule = { none: "A total or a note about the funder's work, not a person." };

export const impactSubjectRules: Readonly<Record<ImpactAuditAction, SubjectRule>> = {
  'impact.framework.created': configuration,
  'impact.framework.changed': configuration,
  'impact.framework.archived': configuration,
  'impact.target.set': configuration,
  'impact.target.changed': configuration,
  'impact.target.removed': configuration,
  'impact.result.recorded': aggregate,
  'impact.result.corrected': aggregate,
  'impact.result.removed': aggregate,
  'impact.learning_note.added': aggregate,
  'impact.learning_note.removed': aggregate,
};
