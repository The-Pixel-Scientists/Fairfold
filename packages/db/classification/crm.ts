// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Field classification for the crm schema (migration 0063, ADR 0016, ADR
// 0025). crm holds party ids, never a copy of a party's name, email,
// address or identifier. Ids, codes, counts, hashes and times are internal.
// Staff's interaction summaries, import cells and external ids and URLs are
// personal. List and segment names and descriptions are configuration that
// must not name a person, as a tag's label is, and segment definitions hold
// field ids, operators and ids. Nothing is special category.
//
// Rows about a party are kept as long as the party, which is the tenant's
// lifetime; merge records too, as the audit trail of every merge. Import rows
// are kept at least 30 days after their job last changed, and import jobs at
// least 90 days, as the record of who imported what, once no row is left:
// tenant policies that app.apply_retention() applies (migration 0064), which
// an admin may lengthen but never shorten. A row that matched or created no
// party has no subject path, so the database caps the settings: rows at 90
// days, and jobs, which keep the uploaded file, at 366, the limit for data
// with no subject path. Erasure (crm.erase_subject, ADR 0027)
// anonymises in place: a summary becomes 'erased', an import row's cells
// become {}, and an external id becomes 'erased:<row id>' with its URL
// cleared. Ids, codes and times stay.

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
const personal: FieldClassification = {
  sensitivity: 'personal',
  retention: { kind: 'tenant_lifetime' },
};
const importRow: FieldClassification = {
  sensitivity: 'internal',
  retention: { kind: 'tenant_policy', policy: 'crm_import_rows', minimumDays: 30 },
};
const importJob: FieldClassification = {
  sensitivity: 'internal',
  retention: { kind: 'tenant_policy', policy: 'crm_import_jobs', minimumDays: 90 },
};

const key = { tenant_id: internal, id: internal } as const;
const times = { created_at: internal, updated_at: internal } as const;
const actors = { created_by: internal, updated_by: internal } as const;

export const crm = {
  'crm.list': {
    ...key,
    name: internal,
    description: internal,
    archived_at: internal,
    ...times,
    ...actors,
  },
  'crm.list_member': {
    ...key,
    list_id: internal,
    party_id: internal,
    added_by: internal,
    ...times,
  },
  'crm.segment': {
    ...key,
    name: internal,
    description: internal,
    definition: internal,
    version: internal,
    archived_at: internal,
    ...times,
    ...actors,
  },
  'crm.interaction': {
    ...key,
    party_id: internal,
    kind: internal,
    occurred_at: internal,
    source_module: internal,
    source_entity_type: internal,
    source_entity_id: internal,
    // Erasure: replaced by 'erased'.
    summary: personal,
    recorded_by: internal,
    ...times,
  },
  'crm.merge_record': {
    ...key,
    kind: internal,
    action: internal,
    loser_id: internal,
    survivor_id: internal,
    repointed_counts: internal,
    preview_hash: internal,
    merged_by: internal,
    merged_at: internal,
  },
  'crm.import_job': {
    tenant_id: importJob,
    id: importJob,
    file_id: importJob,
    target_kind: importJob,
    header_row: importJob,
    column_mapping: importJob,
    state: importJob,
    row_count: importJob,
    valid_count: importJob,
    created_count: importJob,
    error_code: importJob,
    requested_by: importJob,
    confirmed_by: importJob,
    confirmed_at: importJob,
    completed_at: importJob,
    created_at: importJob,
    updated_at: importJob,
  },
  'crm.import_row': {
    tenant_id: importRow,
    id: importRow,
    job_id: importRow,
    row_number: importRow,
    // Erasure: emptied to {}.
    cells: { ...importRow, sensitivity: 'personal' },
    errors: importRow,
    duplicate_party_id: importRow,
    created_party_id: importRow,
    created_at: importRow,
    updated_at: importRow,
  },
  'crm.external_reference': {
    ...key,
    party_id: internal,
    system: internal,
    // Erasure: replaced by 'erased:<row id>', and the URL cleared.
    external_id: personal,
    url: personal,
    added_by: internal,
    ...times,
  },
} satisfies ClassificationRegistry;

/**
 * Each table's path to the party its rows are about (ADR 0027). Lists,
 * segments and import jobs are about no person, so have none.
 */
export const crmSubjects: SubjectPathRegistry = {
  'crm.list_member': { kind: 'party', column: 'party_id' },
  'crm.interaction': { kind: 'party', column: 'party_id' },
  'crm.merge_record': { kind: 'parties', columns: ['loser_id', 'survivor_id'] },
  'crm.import_row': { kind: 'parties', columns: ['created_party_id', 'duplicate_party_id'] },
  'crm.external_reference': { kind: 'party', column: 'party_id' },
};

const stored = ['hosting', 'backup'] as const;
const parties = ['applicant', 'applicant_contact'] as const;

const records = (
  dataSubjects: ProcessingEntry['dataSubjects'],
  dataCategories: ProcessingEntry['dataCategories'],
): ProcessingEntry => ({
  purpose: 'party_records',
  legalBasis: 'legitimate_interests',
  processors: stored,
  dataSubjects,
  dataCategories,
});

export const crmProcessing: ProcessingRegistry<typeof crm> = {
  'crm.list': records([], []),
  'crm.list_member': records(parties, ['other']),
  'crm.segment': records([], []),
  'crm.interaction': records(parties, ['other']),
  'crm.merge_record': records(parties, ['other']),
  'crm.import_job': records([], []),
  'crm.import_row': records(parties, ['identity', 'contact']),
  'crm.external_reference': records(parties, ['online_identifiers']),
};
