// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Who may see a field's answer against an application (ADR 0004, blind
// review). The projection and the definition rules both ask this one
// function, so they cannot disagree.

import type { FormField } from './definition.ts';

/** The applicant, staff, a reviewer, or a reviewer doing blind review. */
export const projectionAudiences = ['applicant', 'staff', 'reviewer', 'blind_reviewer'] as const;

export type ProjectionAudience = (typeof projectionAudiences)[number];

/**
 * Content blocks and aggregate-only answers are for the applicant alone.
 * Blind reviewers see what reviewers see, less identity fields. Any other
 * audience sees nothing.
 */
export function canSee(field: FormField, audience: ProjectionAudience): boolean {
  if (field.type === 'content' || field.audiences === 'aggregate_only') {
    return audience === 'applicant';
  }
  if (audience === 'blind_reviewer') return field.audiences.includes('reviewer') && !field.identity;
  return (field.audiences as readonly string[]).includes(audience);
}
