// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Field classification for the privacy schema (migrations 0089 to 0091, ADR 0016).
// privacy holds a tenant's rights requests, the breach log, DPIAs and the
// records of processing it adds by hand. Ids, codes, counts, dates and times
// are internal, as are member and person ids, as elsewhere in the map. A
// request's summary, a breach's description, likely consequences and
// assessment rationale, and a DPIA's DPO advice are special category: staff
// routinely describe health or similar data in them, so exports and the
// warehouse must never carry them. A task's title, the measures taken, the
// ICO's reference and a DPIA's screening and risks are personal. Processing
// activities and processors describe the tenant's processing, not a person.
//
// A request, its clock events and its tasks reach their person through the
// request's subject. A breach, its assessments, a DPIA and the registers have
// no column that links them to a person, though breach and DPIA text may name
// one, so they are marked as about no person and keep their classes.
//
// Every row is kept for the tenant's lifetime until the platform minimums of
// the privacy_rights_request and privacy_breach policies are confirmed
// (S11-102); a later migration adds those policies' targets to
// app.apply_retention and moves these rules to them.

import type {
  ClassificationRegistry,
  FieldClassification,
  ProcessingEntry,
  ProcessingRegistry,
  Sensitivity,
  SubjectPathRegistry,
} from '../classification.ts';

const kept = (sensitivity: Sensitivity): FieldClassification => ({
  sensitivity,
  retention: { kind: 'tenant_lifetime' },
});

const internal = kept('internal');
const personal = kept('personal');
const special = kept('special_category');

const key = { tenant_id: internal, id: internal } as const;
const changed = {
  created_at: internal,
  created_by: internal,
  updated_at: internal,
  updated_by: internal,
} as const;

export const privacy = {
  'privacy.rights_request': {
    ...key,
    kind: internal,
    subject_person_id: internal,
    received_at: internal,
    received_on: internal,
    channel: internal,
    summary: special,
    identity_check: internal,
    clock_state: internal,
    due_on: internal,
    export_job_request_id: internal,
    erasure_job_request_id: internal,
    ...changed,
  },
  'privacy.request_clock_event': {
    ...key,
    request_id: internal,
    kind: internal,
    occurred_on: internal,
    months: internal,
    reason_code: internal,
    recorded_by: internal,
    created_at: internal,
  },
  'privacy.request_task': {
    ...key,
    request_id: internal,
    title: personal,
    assigned_to: internal,
    module_id: internal,
    due_on: internal,
    completed_by: internal,
    completed_at: internal,
    ...changed,
  },
  'privacy.breach': {
    ...key,
    became_aware_at: internal,
    discovered_at: internal,
    description: special,
    data_categories: internal,
    approx_subjects: internal,
    approx_records: internal,
    consequences: special,
    measures: personal,
    ico_notified_at: internal,
    ico_reference: personal,
    ico_late_reason: internal,
    ico_recorded_by: internal,
    ico_recorded_at: internal,
    subjects_notified_at: internal,
    subjects_notice_method: internal,
    subjects_recorded_by: internal,
    subjects_recorded_at: internal,
    recorded_by: internal,
    updated_by: internal,
    created_at: internal,
    updated_at: internal,
  },
  'privacy.breach_assessment': {
    ...key,
    breach_id: internal,
    risk_level: internal,
    notify_ico: internal,
    notify_subjects: internal,
    rationale: special,
    assessed_by: internal,
    created_at: internal,
  },
  'privacy.processing_activity': {
    ...key,
    name: internal,
    purpose: internal,
    legal_basis: internal,
    special_category_condition: internal,
    data_categories: internal,
    subject_categories: internal,
    recipients: internal,
    transfers_abroad: internal,
    retention: internal,
    security_measures: internal,
    archived_at: internal,
    ...changed,
  },
  'privacy.processor': {
    ...key,
    name: internal,
    service: internal,
    country_code: internal,
    contract_signed_on: internal,
    transfer_safeguard: internal,
    archived_at: internal,
    ...changed,
  },
  'privacy.processing_activity_processor': {
    ...key,
    processing_activity_id: internal,
    processor_id: internal,
    created_by: internal,
    created_at: internal,
  },
  'privacy.dpia': {
    ...key,
    title: internal,
    status: internal,
    screening: personal,
    risks: personal,
    dpo_advice: special,
    signed_off_by: internal,
    signed_off_at: internal,
    review_on: internal,
    ...changed,
  },
  'privacy.dpia_processing_activity': {
    ...key,
    dpia_id: internal,
    processing_activity_id: internal,
    created_by: internal,
    created_at: internal,
  },
} satisfies ClassificationRegistry;

const throughRequest = {
  kind: 'join',
  column: 'request_id',
  table: 'privacy.rights_request',
} as const;

const incident = {
  kind: 'none',
  reason: 'A breach record describes an incident, not a person, and links to no party.',
} as const;
const register = {
  kind: 'none',
  reason: "It records the tenant's processing, not a person.",
} as const;

export const privacySubjects: SubjectPathRegistry = {
  'privacy.rights_request': { kind: 'party', column: 'subject_person_id' },
  'privacy.request_clock_event': throughRequest,
  'privacy.request_task': throughRequest,
  'privacy.breach': incident,
  'privacy.breach_assessment': incident,
  'privacy.dpia': {
    kind: 'none',
    reason: 'A DPIA assesses a kind of processing, not a person, and links to no party.',
  },
  'privacy.dpia_processing_activity': register,
  'privacy.processing_activity': register,
  'privacy.processing_activity_processor': register,
  'privacy.processor': register,
};

/** Anyone a tenant holds data about may ask, or be caught up in a breach. */
const people: ProcessingEntry['dataSubjects'] = [
  'applicant',
  'applicant_contact',
  'staff_member',
  'reviewer',
];

// Meeting the tenant's data protection duties is a legal obligation (UK
// GDPR Articles 12 to 22, 30 and 33 to 35). Special category text is kept
// to establish and defend the tenant's compliance (Article 9(2)(f)).
const duties = (dataCategories: ProcessingEntry['dataCategories']): ProcessingEntry => ({
  purpose: 'data_protection',
  legalBasis: 'legal_obligation',
  processors: ['hosting', 'backup'],
  dataSubjects: dataCategories.length > 0 ? people : [],
  dataCategories,
});
const withText = (dataCategories: ProcessingEntry['dataCategories']): ProcessingEntry => ({
  ...duties(dataCategories),
  article9Condition: 'legal_claims',
});

export const privacyProcessing: ProcessingRegistry<typeof privacy> = {
  'privacy.rights_request': withText(['identity', 'other']),
  'privacy.request_clock_event': duties(['other']),
  'privacy.request_task': duties(['other']),
  'privacy.breach': withText(['other']),
  'privacy.breach_assessment': withText(['other']),
  'privacy.processing_activity': duties([]),
  'privacy.processor': duties([]),
  'privacy.processing_activity_processor': duties([]),
  'privacy.dpia': withText(['other']),
  'privacy.dpia_processing_activity': duties([]),
};
