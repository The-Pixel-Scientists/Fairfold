// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The grants module's own warehouse tables (ADR 0016), kept apart from the
// shared ones so they can be dropped together. A draft is the applicant's
// own unsubmitted work: like the console (S06-04), the warehouse never sees
// it, and a draft is never withdrawn, so every row was submitted. An
// application shows its decision only once released; scores come only from
// submitted reviews, without the reviewer's comment.

import { column, nullable, type WarehouseTable } from './model.ts';

/** A released decision: the outcome and release time decide whether anything shows. */
const released = ['grants.decision.outcome', 'grants.decision.released_at'] as const;

export const grantsTables = {
  grants_round: {
    module: 'grants',
    rows: 'Every round.',
    key: 'id',
    columns: {
      id: column('uuid', 'grants.round.id'),
      programme_id: column('uuid', 'grants.round.programme_id'),
      title: column('text', 'grants.round.title'),
      opens_at: column('timestamptz', 'grants.round.opens_at'),
      closes_at: column('timestamptz', 'grants.round.closes_at'),
      budget_minor: column('bigint', 'grants.round.budget_minor'),
      award_min_minor: column('bigint', 'grants.round.award_min_minor'),
      award_max_minor: column('bigint', 'grants.round.award_max_minor'),
      currency: column('text', 'grants.round.currency'),
      created_at: column('timestamptz', 'grants.round.created_at'),
    },
  },
  grants_application: {
    module: 'grants',
    rows: 'Every submitted or withdrawn application, without its answers; drafts are left out.',
    key: 'id',
    columns: {
      id: column('uuid', 'grants.application.id'),
      round_id: column('uuid', 'grants.application.round_id'),
      organisation_id: column('uuid', 'grants.application.organisation_id'),
      applicant_person_id: column('uuid', 'grants.application.applicant_person_id'),
      status: column('text', 'grants.application.status'),
      submitted_at: column('timestamptz', 'grants.application.submitted_at'),
      submitted_late: column('boolean', 'grants.application.submitted_late'),
      withdrawn_at: nullable('timestamptz', 'grants.application.withdrawn_at'),
      // The decision's outcome once released; null before.
      outcome: nullable('text', ...released),
      // The commitment of a released award; null otherwise.
      commitment_id: nullable('uuid', 'grants.decision.id', ...released),
      created_at: column('timestamptz', 'grants.application.created_at'),
    },
  },
  grants_score: {
    module: 'grants',
    rows: "Each criterion's score in a submitted review, without the reviewer's comment.",
    key: 'id',
    columns: {
      id: column('uuid', 'grants.score.id'),
      application_id: column('uuid', 'grants.assignment.application_id'),
      round_id: column('uuid', 'grants.assignment.round_id'),
      stage_id: column('uuid', 'grants.score.stage_id'),
      assignment_id: column('uuid', 'grants.score.assignment_id'),
      criterion_id: column('uuid', 'grants.score.criterion_id'),
      criterion: column('text', 'grants.rubric_criterion.label'),
      weight: column('integer', 'grants.rubric_criterion.weight'),
      score: column('integer', 'grants.score.score'),
      submitted_at: column('timestamptz', 'grants.assignment.submitted_at'),
    },
  },
} as const satisfies Record<string, WarehouseTable>;
