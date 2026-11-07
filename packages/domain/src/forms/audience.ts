// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Who may see a field's answer (ADR 0004, blind review). The projection and
// the definition rules both ask this one function, so they cannot disagree.

import type { FormField } from './definition.ts';

/**
 * The applicant, staff, a reviewer, a reviewer doing blind review, or the
 * respondent to a standalone form (ADR 0036).
 */
export const projectionAudiences = [
  'applicant',
  'staff',
  'reviewer',
  'blind_reviewer',
  'respondent',
] as const;

export type ProjectionAudience = (typeof projectionAudiences)[number];

/**
 * Content blocks and aggregate-only answers are for the person who answered
 * alone: the applicant, or the respondent, who sees what an applicant would.
 * Blind reviewers see what reviewers see, less identity fields and every
 * file question, because a document can name the applicant whatever it is
 * called (ADR 0047). Any other audience sees nothing.
 */
export function canSee(field: FormField, audience: ProjectionAudience): boolean {
  const who = audience === 'respondent' ? 'applicant' : audience;
  if (field.type === 'content' || field.audiences === 'aggregate_only') {
    return who === 'applicant';
  }
  if (who === 'blind_reviewer') {
    return field.type !== 'file' && field.audiences.includes('reviewer') && !field.identity;
  }
  return (field.audiences as readonly string[]).includes(who);
}
