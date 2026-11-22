// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Field classification for the insight schema (migration 0080, ADR 0016).
// insight holds report definitions, the disclosure rule and regulatory
// publication runs: configuration and the record of what was prepared,
// never a row about a person and never an aggregate (ADR 0032). No table
// names a party, so none has a subject path, and subject access and erasure
// have nothing to reach here (ADR 0027). Ids, kinds, states, versions,
// periods, codes, thresholds, times and member ids are internal. A report's
// definition is codes, ids and column names, with a name, description and
// filter values that are staff's words about the work, which must not name
// a person, as a crm list's description must not. A run's output is
// classified with app.file. Nothing is personal or special category.
//
// Every row is kept for the tenant's lifetime: reports and rules are
// versioned configuration, and a publication run is the funder's record of
// what it filed with a regulator, which no accounting period outlasts.

import type {
  ClassificationRegistry,
  FieldClassification,
  ProcessingEntry,
  ProcessingRegistry,
} from '../classification.ts';

const internal: FieldClassification = {
  sensitivity: 'internal',
  retention: { kind: 'tenant_lifetime' },
};

const key = { tenant_id: internal, id: internal } as const;
const times = { created_at: internal, updated_at: internal } as const;
const actors = { created_by: internal, updated_by: internal } as const;

export const insight = {
  'insight.report_definition': {
    ...key,
    kind: internal,
    name: internal,
    definition: internal,
    version: internal,
    archived_at: internal,
    ...times,
    ...actors,
  },
  'insight.disclosure_rule': {
    ...key,
    threshold: internal,
    minimum_group: internal,
    version: internal,
    ...times,
    ...actors,
  },
  'insight.publication_run': {
    ...key,
    kind: internal,
    period_start: internal,
    period_end: internal,
    state: internal,
    output_file_id: internal,
    error_code: internal,
    prepared_by: internal,
    submitted_by: internal,
    submitted_at: internal,
    ...times,
  },
} satisfies ClassificationRegistry;

const reporting: ProcessingEntry = {
  purpose: 'grant_monitoring',
  legalBasis: 'legitimate_interests',
  processors: ['hosting', 'backup'],
  dataSubjects: [],
  dataCategories: [],
};

export const insightProcessing: ProcessingRegistry<typeof insight> = {
  'insight.report_definition': reporting,
  'insight.disclosure_rule': reporting,
  // The annual return and the SORP grant-making note are a charity's duty.
  'insight.publication_run': { ...reporting, legalBasis: 'legal_obligation' },
};
