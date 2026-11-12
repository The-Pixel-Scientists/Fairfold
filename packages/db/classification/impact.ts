// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Field classification for the impact schema (migration 0067, ADR 0016).
// impact holds outcomes frameworks, targets, results and what staff learned
// from them: totals about the work, never a row about a person. No table
// names a party, so none has a subject path. Ids, codes, figures, dates and
// times are internal. Names, descriptions, result notes, evidence captions
// and learning notes are staff's words about the work, which must not name
// a person, as a crm list's description must not; the screens say so beside
// each box. An evidence file is classified with app.file, which reaches the
// member who uploaded it. Nothing is personal or special category.
//
// Every row is kept for the tenant's lifetime: a framework and its results
// are the funder's record of what its grants achieved.

import type {
  ClassificationRegistry,
  FieldClassification,
  ProcessingEntry,
  ProcessingRegistry,
  SubjectPathRegistry,
} from '../classification.ts';

const internal: FieldClassification = {
  sensitivity: 'internal',
  retention: { kind: 'tenant_lifetime' },
};

const key = { tenant_id: internal, id: internal } as const;
const times = { created_at: internal, updated_at: internal } as const;
const actors = { created_by: internal, updated_by: internal } as const;
const period = {
  framework_id: internal,
  indicator_id: internal,
  programme_id: internal,
  period_start: internal,
  period_end: internal,
} as const;

export const impact = {
  'impact.framework': {
    ...key,
    name: internal,
    description: internal,
    version: internal,
    archived_at: internal,
    ...times,
    ...actors,
  },
  'impact.outcome': {
    ...key,
    framework_id: internal,
    name: internal,
    description: internal,
    position: internal,
    ...times,
  },
  'impact.indicator': {
    ...key,
    framework_id: internal,
    outcome_id: internal,
    name: internal,
    unit: internal,
    direction: internal,
    aggregation: internal,
    position: internal,
    ...times,
  },
  'impact.target': {
    ...key,
    ...period,
    baseline: internal,
    target: internal,
    ...times,
    ...actors,
  },
  'impact.result': {
    ...key,
    ...period,
    value: internal,
    note: internal,
    source: internal,
    recorded_by: internal,
    updated_by: internal,
    ...times,
  },
  'impact.result_evidence': {
    ...key,
    framework_id: internal,
    result_id: internal,
    file_id: internal,
    caption: internal,
    added_by: internal,
    created_at: internal,
  },
  'impact.learning_note': {
    ...key,
    framework_id: internal,
    outcome_id: internal,
    body: internal,
    created_by: internal,
    created_at: internal,
  },
} satisfies ClassificationRegistry;

export const impactSubjects: SubjectPathRegistry = {};

const monitoring: ProcessingEntry = {
  purpose: 'grant_monitoring',
  legalBasis: 'legitimate_interests',
  processors: ['hosting', 'backup'],
  dataSubjects: [],
  dataCategories: [],
};

export const impactProcessing: ProcessingRegistry<typeof impact> = {
  'impact.framework': monitoring,
  'impact.outcome': monitoring,
  'impact.indicator': monitoring,
  'impact.target': monitoring,
  'impact.result': monitoring,
  'impact.result_evidence': monitoring,
  'impact.learning_note': monitoring,
};
