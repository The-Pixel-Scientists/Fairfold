// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Field classification for the app schema. Ids, statuses and settings are
// internal; a tenant's slug, name and theme are public, since its public
// pages show them (ADR 0019). A membership's user_id links the tenant to a
// person's account, so it is personal, like party.person.user_id (ADR 0017).
// Audit events hold ids, codes and public or internal values only (ADR 0003,
// D12), and are kept under the tenant's audit rule, at least 12 months; the
// party an event is about is internal under the same rule (ADR 0027).

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
const publicField: FieldClassification = {
  sensitivity: 'public',
  retention: { kind: 'tenant_lifetime' },
};
const personal: FieldClassification = {
  sensitivity: 'personal',
  retention: { kind: 'tenant_lifetime' },
};
const invitation: FieldClassification = {
  sensitivity: 'internal',
  retention: { kind: 'fixed', days: 90, from: 'expires_at' },
};
const idempotencyKey: FieldClassification = {
  sensitivity: 'internal',
  retention: { kind: 'fixed', days: 2, from: 'created_at' },
};
const requestLimit: FieldClassification = {
  sensitivity: 'internal',
  retention: { kind: 'fixed', days: 1, from: 'window_start' },
};
const jobRequest: FieldClassification = {
  sensitivity: 'internal',
  retention: { kind: 'fixed', days: 7, from: 'completed_at' },
};
const audit: FieldClassification = {
  sensitivity: 'internal',
  retention: { kind: 'tenant_policy', policy: 'audit', minimumDays: 365 },
};
/** 7 years, the longest off-site tier (ADR 0011), never under a tenant's policy. */
const erasureLedger: FieldClassification = {
  sensitivity: 'internal',
  retention: { kind: 'fixed', days: 2557, from: 'erased_at' },
};

/**
 * Columns whose values are structured (json, jsonb, bytea) or free text. An
 * audit event records a change to one by its field id alone, whatever its
 * sensitivity (D12). The other schemas' maps have no such marker yet (S11-84).
 */
export const notKept: ReadonlySet<string> = new Set([
  'app.tenant_theme.logo',
  'app.tenant_theme.tokens',
  'app.config_version.diff',
  'app.file.sha256',
  'app.invitation.token_hash',
  'app.idempotency_key.request_hash',
  'app.request_limit.key_hash',
  'app.audit_event.changes',
  'app.job_request.filters',
  'app.subject_key.wrapped_key',
]);

export const app = {
  'app.tenant': {
    id: internal,
    slug: publicField,
    name: publicField,
    status: internal,
    timezone: internal,
    fiscal_year_start_month: internal,
    created_at: internal,
    updated_at: internal,
  },
  'app.membership': {
    tenant_id: internal,
    id: internal,
    user_id: personal,
    roles: internal,
    status: internal,
    created_at: internal,
    created_by: internal,
    updated_at: internal,
    updated_by: internal,
  },
  'app.tenant_module': {
    tenant_id: internal,
    id: internal,
    module: internal,
    enabled: internal,
    updated_at: internal,
    updated_by: internal,
    updated_by_kind: internal,
  },
  'app.tenant_theme': {
    tenant_id: internal,
    id: internal,
    brand_colour: publicField,
    preset: publicField,
    logo: publicField,
    logo_type: publicField,
    tokens: publicField,
    updated_at: internal,
    updated_by: internal,
  },
  'app.config_version': {
    tenant_id: internal,
    id: internal,
    entity_type: internal,
    entity_id: internal,
    version: internal,
    author_id: internal,
    author_kind: internal,
    diff: internal,
    created_at: internal,
  },
  'app.retention_policy': {
    tenant_id: internal,
    id: internal,
    policy: internal,
    days: internal,
    created_at: internal,
    created_by: internal,
    updated_at: internal,
    updated_by: internal,
  },
  // An uploaded file (ADR 0047). Its name often names a person. A linked
  // file follows its record's retention rule, as grants.application's, and
  // the file sweep removes it once released; a refused (infected or error)
  // row, linked to nothing, goes 12 months after its scan, the audit floor
  // (ADR 0030). An erased row keeps no name, hash or key.
  'app.file': {
    tenant_id: internal,
    id: internal,
    name: personal,
    content_type: internal,
    size_bytes: internal,
    sha256: internal,
    // The object this key names holds personal content, under the same rule.
    storage_key: internal,
    scan_state: internal,
    scanned_at: internal,
    scan_version: internal,
    linked_at: internal,
    released_at: internal,
    erased_at: internal,
    created_by: internal,
    created_at: internal,
    updated_by: internal,
    updated_at: internal,
  },
  // An invitation to the team (ADR 0010). The address names a person who may
  // never join, so every row goes 90 days after it expires, whatever its
  // status; a membership it made stays.
  'app.invitation': {
    tenant_id: invitation,
    id: invitation,
    email: { ...invitation, sensitivity: 'personal' },
    roles: invitation,
    token_hash: invitation,
    expires_at: invitation,
    status: invitation,
    accepted_membership_id: invitation,
    created_at: invitation,
    created_by: invitation,
    updated_at: invitation,
    updated_by: invitation,
  },
  // An idempotency key (ADR 0028): kept 2 days, its 24-hour expiry plus a
  // margin for the purge. The request hash digests values that may be
  // personal, so it is classified as they may be.
  'app.idempotency_key': {
    tenant_id: idempotencyKey,
    id: idempotencyKey,
    membership_id: idempotencyKey,
    route_id: idempotencyKey,
    key: idempotencyKey,
    request_hash: { ...idempotencyKey, sensitivity: 'personal' },
    state: idempotencyKey,
    status: idempotencyKey,
    created_id: idempotencyKey,
    created_at: idempotencyKey,
    expires_at: idempotencyKey,
  },
  // A rate-limit counter (ADR 0028), holding no tenant data: kept 1 day from
  // its window. Its key hash is a pseudonymous client identifier.
  'app.request_limit': {
    bucket: requestLimit,
    key_hash: { ...requestLimit, sensitivity: 'personal' },
    window_start: requestLimit,
    count: requestLimit,
    expires_at: requestLimit,
  },
  'app.audit_event': {
    tenant_id: audit,
    id: audit,
    occurred_at: audit,
    retain_until: audit,
    request_id: audit,
    actor_kind: audit,
    actor_id: audit,
    actor_member_kind: audit,
    action: audit,
    entity_type: audit,
    entity_id: audit,
    changes: audit,
    subject_party_id: audit,
    job_id: audit,
    origin_membership_id: audit,
  },
  // The queue register (ADR 0009): platform configuration.
  'app.job_queue': {
    name: internal,
    kind: internal,
    created_at: internal,
  },
  // A job acting for a member (ADR 0009): kept 7 days from completion, as
  // its output is. Its filters may name the party a subject access request
  // is about. Its audit event keeps the id, requester and permission.
  'app.job_request': {
    tenant_id: jobRequest,
    id: jobRequest,
    kind: jobRequest,
    requested_by: jobRequest,
    permission: jobRequest,
    filters: { ...jobRequest, sensitivity: 'personal' },
    field_ids: jobRequest,
    output_sensitivity: jobRequest,
    request_id: jobRequest,
    status: jobRequest,
    failure_code: jobRequest,
    output_file_id: jobRequest,
    requested_at: jobRequest,
    updated_at: jobRequest,
    completed_at: jobRequest,
    expires_at: jobRequest,
  },
  // A subject's data key for audit values (ADR 0027), wrapped by the
  // platform key: kept with its party, the key itself gone once destroyed.
  'app.subject_key': {
    tenant_id: internal,
    subject_party_id: internal,
    id: internal,
    wrapped_key: internal,
    kek_version: internal,
    created_at: internal,
    destroyed_at: internal,
  },
  // Who was erased, as ids and times, so a restore can erase them again
  // (ADR 0027). Plain ids: no foreign key, so no subject path.
  'app.erasure_ledger': {
    tenant_id: erasureLedger,
    id: erasureLedger,
    subject_party_id: erasureLedger,
    kind: erasureLedger,
    subject_key_id: erasureLedger,
    audit_event_id: erasureLedger,
    erased_at: erasureLedger,
    retain_until: erasureLedger,
  },
  // Whether this cell is being restored (ADR 0011): one row, no tenant's.
  'app.restore_mode': {
    id: internal,
    active: internal,
    request_id: internal,
    created_at: internal,
    created_by: internal,
    updated_at: internal,
    updated_by: internal,
  },
} satisfies ClassificationRegistry;

/**
 * Each table's path to the party its rows are about (ADR 0027). A file is
 * about the member who uploaded it, an invitation about the member it made,
 * if any, and a job request about the member who asked.
 */
export const appSubjects: SubjectPathRegistry = {
  'app.membership': { kind: 'account', column: 'user_id' },
  'app.file': { kind: 'join', column: 'created_by', table: 'app.membership' },
  'app.invitation': { kind: 'join', column: 'accepted_membership_id', table: 'app.membership' },
  'app.idempotency_key': {
    kind: 'unlinked',
    reason: 'A one-way digest of a request, which names no one and goes after 2 days.',
  },
  'app.request_limit': {
    kind: 'unlinked',
    reason: 'A hashed client key for rate limits, with no account or tenant.',
  },
  'app.audit_event': { kind: 'party', column: 'subject_party_id' },
  'app.job_request': { kind: 'join', column: 'requested_by', table: 'app.membership' },
  'app.subject_key': { kind: 'party', column: 'subject_party_id' },
};

const stored = ['hosting', 'backup'] as const;
const tenantPeople = ['applicant', 'applicant_contact', 'staff_member', 'reviewer'] as const;
const members = ['applicant', 'staff_member', 'reviewer'] as const;

/** A table of the tenant's own set-up, holding no person's data. */
const setUp: ProcessingEntry = {
  purpose: 'tenant_administration',
  legalBasis: 'contract',
  processors: stored,
  dataSubjects: [],
  dataCategories: [],
};
const auditRow: ProcessingEntry = {
  purpose: 'audit',
  legalBasis: 'legitimate_interests',
  processors: stored,
  dataSubjects: tenantPeople,
  dataCategories: ['other'],
};

export const appProcessing: ProcessingRegistry<typeof app> = {
  'app.tenant': setUp,
  'app.membership': {
    purpose: 'tenant_administration',
    legalBasis: 'legitimate_interests',
    processors: stored,
    dataSubjects: members,
    dataCategories: ['identity'],
  },
  'app.tenant_module': setUp,
  'app.tenant_theme': setUp,
  'app.config_version': setUp,
  'app.retention_policy': setUp,
  'app.file': {
    purpose: 'file_storage',
    legalBasis: 'contract',
    processors: [...stored, 'malware_scanning'],
    dataSubjects: members,
    dataCategories: ['identity', 'other'],
  },
  'app.invitation': {
    purpose: 'tenant_administration',
    legalBasis: 'legitimate_interests',
    processors: [...stored, 'email'],
    dataSubjects: ['staff_member', 'reviewer'],
    dataCategories: ['contact'],
  },
  'app.idempotency_key': {
    purpose: 'service_reliability',
    legalBasis: 'legitimate_interests',
    processors: stored,
    dataSubjects: members,
    dataCategories: ['other'],
  },
  'app.request_limit': {
    purpose: 'service_reliability',
    legalBasis: 'legitimate_interests',
    processors: stored,
    dataSubjects: ['visitor'],
    dataCategories: ['online_identifiers'],
  },
  'app.audit_event': auditRow,
  'app.job_queue': {
    purpose: 'background_jobs',
    legalBasis: 'legitimate_interests',
    processors: stored,
    dataSubjects: [],
    dataCategories: [],
  },
  'app.job_request': {
    purpose: 'background_jobs',
    legalBasis: 'legitimate_interests',
    processors: stored,
    dataSubjects: tenantPeople,
    dataCategories: ['identity'],
  },
  'app.subject_key': auditRow,
  // Its party ids have no foreign key, so no subject path: it states none.
  'app.erasure_ledger': { ...auditRow, dataSubjects: [], dataCategories: [] },
  'app.restore_mode': {
    purpose: 'service_reliability',
    legalBasis: 'legitimate_interests',
    processors: stored,
    dataSubjects: [],
    dataCategories: [],
  },
};
