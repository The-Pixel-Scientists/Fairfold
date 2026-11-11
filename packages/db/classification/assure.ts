// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Field classification for the assure schema (ADR 0031). Ids, codes,
// versions, similarities, counts and times are internal. Register fields
// take their class from the assure contracts' registryResultClassification:
// an organisation's registered address is personal, as it may be a home
// (ADR 0017), and officers' names are personal. A screened name, a listed
// person's names, dates of birth and nationalities, checklist answers,
// visit findings, follow-ups and captions are personal; the rest of a list
// entry is public. Nothing is special category: no PEP, adverse-media or
// criminal record data is held.
//
// Retention, until S11-102's retention functions take tenant policies for
// assure (ADR 0031's assure.lookup and assure.screening, 6 years by
// default): snapshots, runs, matches and decisions are kept a fixed 6
// years; officer rows 12 months from the lookup, ADR 0027's limit for names
// of people the tenant may not hold as parties; list entries 90 days after
// their list version is replaced. Checklists are tenant configuration.
// Answers and visits stay with the application or organisation they belong
// to, as those do. Erasure anonymises in place through assure.erase_subject
// (migration 0058): names and free text become 'erased' or are cleared, and
// a person's attendee rows are removed.

import type {
  ClassificationRegistry,
  FieldClassification,
  ProcessingEntry,
  ProcessingRegistry,
  SubjectPathRegistry,
} from '../classification.ts';

const SIX_YEARS = 2190;

const kept = (
  sensitivity: FieldClassification['sensitivity'],
  retention: FieldClassification['retention'],
): FieldClassification => ({ sensitivity, retention });
const asPersonal = (field: FieldClassification): FieldClassification => ({
  ...field,
  sensitivity: 'personal',
});

const internal = kept('internal', { kind: 'tenant_lifetime' });
const personal = asPersonal(internal);

const list = kept('internal', { kind: 'tenant_lifetime' });
const entry = kept('public', { kind: 'fixed', days: 90, from: 'superseded_at' });
const listed = asPersonal(entry);

const looked = kept('internal', { kind: 'fixed', days: SIX_YEARS, from: 'fetched_at' });
const officer = kept('internal', { kind: 'fixed', days: 365, from: 'created_at' });
const screened = kept('internal', { kind: 'fixed', days: SIX_YEARS, from: 'created_at' });
const decided = kept('internal', { kind: 'fixed', days: SIX_YEARS, from: 'decided_at' });

export const assure = {
  'assure.reference_list': {
    id: list,
    source: list,
    published_on: list,
    downloaded_at: list,
    last_checked_at: list,
    sha256: list,
    row_count: list,
    superseded_at: list,
  },
  'assure.sanctions_entry': {
    id: entry,
    list_id: entry,
    designation_id: entry,
    entry_kind: entry,
    name_type: entry,
    name: listed,
    normalised_name: listed,
    regime: entry,
    designated_on: entry,
    dates_of_birth: listed,
    nationalities: listed,
    country: entry,
    superseded_at: entry,
  },
  'assure.lookup_snapshot': {
    tenant_id: looked,
    id: looked,
    organisation_id: looked,
    registry: looked,
    scheme: looked,
    identifier: looked,
    outcome: looked,
    list_id: looked,
    registry_status: looked,
    registered_name: looked,
    address_line1: asPersonal(looked),
    address_line2: asPersonal(looked),
    address_town: asPersonal(looked),
    address_postcode: asPersonal(looked),
    address_country_code: asPersonal(looked),
    registered_on: looked,
    removed_on: looked,
    accounts_period_end: looked,
    income_minor: looked,
    income_currency: looked,
    expenditure_minor: looked,
    expenditure_currency: looked,
    accounts_overdue: looked,
    fetched_at: looked,
  },
  'assure.lookup_officer': {
    tenant_id: officer,
    id: officer,
    snapshot_id: officer,
    name: asPersonal(officer),
    role: officer,
    person_id: officer,
    linked_by: officer,
    linked_at: officer,
    created_at: officer,
  },
  'assure.screening_run': {
    tenant_id: screened,
    id: screened,
    party_id: screened,
    trigger: screened,
    status: screened,
    list_id: screened,
    list_last_checked_at: screened,
    threshold: screened,
    names_screened: screened,
    matches_raised: screened,
    error_code: screened,
    requested_by: screened,
    completed_at: screened,
    created_at: screened,
    updated_at: screened,
  },
  'assure.screening_match': {
    tenant_id: screened,
    id: screened,
    run_id: screened,
    party_id: screened,
    name_source: screened,
    officer_id: screened,
    subject_party_id: screened,
    screened_name: asPersonal(screened),
    list_id: screened,
    designation_id: screened,
    entry_kind: screened,
    entry_name: asPersonal(screened),
    regime: screened,
    designated_on: screened,
    dates_of_birth: asPersonal(screened),
    nationalities: asPersonal(screened),
    country: screened,
    similarity: screened,
    created_at: screened,
  },
  'assure.match_decision': {
    tenant_id: decided,
    id: decided,
    match_id: decided,
    outcome: decided,
    reason_code: decided,
    decided_by: decided,
    decided_at: decided,
  },
  'assure.checklist': {
    tenant_id: internal,
    id: internal,
    programme_id: internal,
    name: internal,
    current_version: internal,
    archived_at: internal,
    created_by: internal,
    updated_by: internal,
    created_at: internal,
    updated_at: internal,
  },
  'assure.checklist_version': {
    tenant_id: internal,
    id: internal,
    checklist_id: internal,
    version: internal,
    name: internal,
    description: internal,
    items: internal,
    published_by: internal,
    created_at: internal,
  },
  'assure.checklist_response': {
    tenant_id: internal,
    id: internal,
    application_id: internal,
    checklist_id: internal,
    checklist_version_id: internal,
    answers: personal,
    saved_by: internal,
    created_at: internal,
    updated_at: internal,
  },
  // A file may name people, so its link is personal; it goes with the response.
  'assure.checklist_response_file': {
    tenant_id: internal,
    id: internal,
    response_id: internal,
    item_id: internal,
    file_id: personal,
    created_by: internal,
    created_at: internal,
  },
  'assure.monitoring_visit': {
    tenant_id: internal,
    id: internal,
    organisation_id: internal,
    application_id: internal,
    visited_on: internal,
    visit_type: internal,
    findings: personal,
    follow_ups: personal,
    recorded_by: internal,
    updated_by: internal,
    created_at: internal,
    updated_at: internal,
  },
  // That a person attended a visit is about them.
  'assure.visit_attendee': {
    tenant_id: internal,
    id: internal,
    visit_id: internal,
    person_id: personal,
    created_at: internal,
  },
  'assure.visit_evidence': {
    tenant_id: internal,
    id: internal,
    visit_id: internal,
    file_id: personal,
    caption: personal,
    added_by: internal,
    created_at: internal,
  },
} satisfies ClassificationRegistry;

/**
 * Each table's path to the party its rows are about (ADR 0027, ADR 0031).
 * An officer row reaches a person only once a member links it. Reference
 * lists, checklists and their versions are about no person, so have none.
 */
export const assureSubjects: SubjectPathRegistry = {
  'assure.sanctions_entry': {
    kind: 'unlinked',
    reason:
      'Published sanctions list entries, about people no tenant holds as parties, kept while their list version is current and 90 days after.',
  },
  'assure.lookup_snapshot': { kind: 'party', column: 'organisation_id' },
  'assure.lookup_officer': { kind: 'party', column: 'person_id' },
  'assure.screening_run': { kind: 'party', column: 'party_id' },
  'assure.screening_match': { kind: 'party', column: 'subject_party_id' },
  'assure.match_decision': { kind: 'join', column: 'match_id', table: 'assure.screening_match' },
  'assure.checklist_response': {
    kind: 'join',
    column: 'application_id',
    table: 'grants.application',
  },
  'assure.checklist_response_file': {
    kind: 'join',
    column: 'response_id',
    table: 'assure.checklist_response',
  },
  'assure.monitoring_visit': { kind: 'party', column: 'organisation_id' },
  'assure.visit_attendee': { kind: 'party', column: 'person_id' },
  'assure.visit_evidence': { kind: 'join', column: 'visit_id', table: 'assure.monitoring_visit' },
};

const stored = ['hosting', 'backup'] as const;
const screenedPeople = ['applicant', 'applicant_contact', 'organisation_officer'] as const;

/** Checking an applicant before funding them. Each basis is a proposal for the solicitor. */
const dueDiligence = (dataSubjects: ProcessingEntry['dataSubjects']): ProcessingEntry => ({
  purpose: 'due_diligence',
  legalBasis: 'legitimate_interests',
  processors: stored,
  dataSubjects,
  dataCategories: dataSubjects.length > 0 ? ['identity', 'other'] : [],
});
/** Not making funds available to a designated person is a legal obligation. */
const screening = (dataSubjects: ProcessingEntry['dataSubjects']): ProcessingEntry => ({
  purpose: 'sanctions_screening',
  legalBasis: 'legal_obligation',
  processors: stored,
  dataSubjects,
  dataCategories: dataSubjects.length > 0 ? ['identity'] : [],
});
const monitoring: ProcessingEntry = {
  purpose: 'grant_monitoring',
  legalBasis: 'legitimate_interests',
  processors: stored,
  dataSubjects: ['applicant', 'applicant_contact'],
  dataCategories: ['identity', 'other'],
};

export const assureProcessing: ProcessingRegistry<typeof assure> = {
  'assure.reference_list': screening([]),
  'assure.sanctions_entry': screening(['listed_person']),
  'assure.lookup_snapshot': dueDiligence(['applicant']),
  'assure.lookup_officer': dueDiligence(['organisation_officer']),
  'assure.screening_run': screening(screenedPeople),
  'assure.screening_match': screening([...screenedPeople, 'listed_person']),
  'assure.match_decision': screening(screenedPeople),
  'assure.checklist': dueDiligence([]),
  'assure.checklist_version': dueDiligence([]),
  'assure.checklist_response': dueDiligence(['applicant', 'applicant_contact']),
  'assure.checklist_response_file': dueDiligence(['applicant', 'applicant_contact']),
  'assure.monitoring_visit': monitoring,
  'assure.visit_attendee': monitoring,
  'assure.visit_evidence': monitoring,
};
