// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Field classification for the grants schema. A programme's title and
// summary, and a round's title, dates and award range, are public:
// applicants see them. The rest of the set-up (descriptions, budgets, late
// policies, stages, rubrics, email templates and application forms) is
// internal, as are ids, statuses and actors. An application's answers are
// personal as a whole until each form field carries its own classification;
// its links to people and organisations are internal ids, as are its
// statuses, times, late flag, eligibility outcomes and file links (ADR
// 0047). Reviewer pools, assignments, conflict declarations and scores are
// internal, but for a score's comment, which is personal: a reviewer's
// words about an applicant. Everything is kept while the tenant is a
// customer: applications, scores and sent emails refer to the set-up, and
// erasure anonymises a person in place (ADR 0017).

import type { ClassificationRegistry, FieldClassification } from '../classification.ts';

const internal: FieldClassification = {
  sensitivity: 'internal',
  retention: { kind: 'tenant_lifetime' },
};
const shown: FieldClassification = {
  sensitivity: 'public',
  retention: { kind: 'tenant_lifetime' },
};
const personal: FieldClassification = {
  sensitivity: 'personal',
  retention: { kind: 'tenant_lifetime' },
};

const keyAndActors = {
  tenant_id: internal,
  id: internal,
  created_at: internal,
  created_by: internal,
  updated_at: internal,
  updated_by: internal,
} as const;

export const grants: ClassificationRegistry = {
  'grants.programme': {
    ...keyAndActors,
    title: shown,
    summary: shown,
    description: internal,
    status: internal,
  },
  'grants.round': {
    ...keyAndActors,
    programme_id: internal,
    title: shown,
    opens_at: shown,
    closes_at: shown,
    timezone: shown,
    budget_minor: internal,
    award_min_minor: shown,
    award_max_minor: shown,
    currency: shown,
    late_policy: internal,
  },
  'grants.stage': {
    ...keyAndActors,
    round_id: internal,
    name: internal,
    position: internal,
  },
  'grants.rubric_criterion': {
    ...keyAndActors,
    stage_id: internal,
    label: internal,
    guidance: internal,
    weight: internal,
    scale_min: internal,
    scale_max: internal,
    position: internal,
  },
  'grants.email_template_version': {
    tenant_id: internal,
    id: internal,
    programme_id: internal,
    outcome: internal,
    version: internal,
    subject: internal,
    body: internal,
    created_at: internal,
    created_by: internal,
  },
  'grants.form_version': {
    ...keyAndActors,
    round_id: internal,
    version: internal,
    status: internal,
    definition: internal,
    published_at: internal,
    published_by: internal,
  },
  'grants.application': {
    ...keyAndActors,
    round_id: internal,
    form_version_id: internal,
    applicant_person_id: internal,
    organisation_id: internal,
    status: internal,
    answers: personal,
    answers_version: internal,
    stage_id: internal,
    submitted_at: internal,
    submitted_late: internal,
    withdrawn_at: internal,
  },
  'grants.eligibility_result': {
    tenant_id: internal,
    id: internal,
    application_id: internal,
    form_version_id: internal,
    outcome: internal,
    stopping_field_id: internal,
    checked_at: internal,
    checked_by: internal,
  },
  'grants.stage_transition': {
    tenant_id: internal,
    id: internal,
    round_id: internal,
    application_id: internal,
    from_stage_id: internal,
    to_stage_id: internal,
    moved_at: internal,
    moved_by: internal,
  },
  'grants.application_file': {
    tenant_id: internal,
    id: internal,
    application_id: internal,
    file_id: internal,
    field_id: internal,
    created_by: internal,
    created_at: internal,
  },
  'grants.reviewer': {
    tenant_id: internal,
    id: internal,
    round_id: internal,
    membership_id: internal,
    added_at: internal,
    added_by: internal,
  },
  'grants.assignment': {
    ...keyAndActors,
    round_id: internal,
    application_id: internal,
    reviewer_membership_id: internal,
    stage_id: internal,
    status: internal,
    submitted_at: internal,
  },
  'grants.conflict_declaration': {
    tenant_id: internal,
    id: internal,
    assignment_id: internal,
    declared_at: internal,
    declared_by: internal,
  },
  'grants.score': {
    ...keyAndActors,
    assignment_id: internal,
    stage_id: internal,
    criterion_id: internal,
    score: internal,
    comment: personal,
  },
};
