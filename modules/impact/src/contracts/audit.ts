// SPDX-License-Identifier: AGPL-3.0-or-later
//
// impact's audit action codes (architecture rule 4). Events hold ids, codes
// and versions: never a figure, a note's text or a caption. Results are
// totals about a programme's work, not records about a person, so none has a
// subject party id.

import { defineAuditActions } from '@pixel-scientists/domain/platform';

export const impactAuditActions = defineAuditActions('impact', [
  'impact.framework.created',
  'impact.framework.changed',
  'impact.framework.archived',
  'impact.target.set',
  'impact.target.changed',
  'impact.target.removed',
  'impact.result.recorded',
  // A correction keeps the result's id; the event names the fields changed.
  'impact.result.corrected',
  'impact.result.removed',
  'impact.learning_note.added',
  'impact.learning_note.removed',
]);

export type ImpactAuditAction = (typeof impactAuditActions)[number];
