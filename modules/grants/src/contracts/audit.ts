// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The grants module's audit action codes (architecture rule 4, ADR 0016).
// Events hold ids, codes and field ids, never personal values. Later grants
// contracts add their codes to this one list.

import { defineAuditActions } from '@pixel-scientists/domain/platform';

export const grantsAuditActions = defineAuditActions('grants', [
  // Programme set-up (S04-01).
  'grants.programme.created',
  'grants.programme.updated',
  'grants.programme.email_templates_changed',
  'grants.round.created',
  'grants.round.updated',
  'grants.round.stages_changed',
  'grants.stage.rubric_changed',
]);

export type GrantsAuditAction = (typeof grantsAuditActions)[number];
