// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Field classification for the grants schema. A programme's title and
// summary, and a round's title, dates and award range, are public:
// applicants see them. The rest of the set-up (descriptions, budgets, late
// policies, stages, rubrics and email templates) is internal, as are ids,
// statuses and actors. Nothing here is personal. Set-up is kept while the
// tenant is a customer, since applications, scores and sent emails refer
// to it.

import type { ClassificationRegistry, FieldClassification } from '../classification.ts';

const internal: FieldClassification = {
  sensitivity: 'internal',
  retention: { kind: 'tenant_lifetime' },
};
const shown: FieldClassification = {
  sensitivity: 'public',
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
};
