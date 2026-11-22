// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Field classification for the party schema (ADR 0017). A person's names,
// email, phone and account link, everything a consent row says, and an
// organisation's registered address, which for a small group is often
// someone's home, are personal. Row and tenant ids are internal, as in
// every schema. The rest is internal too, including organisation names,
// legal forms, websites and identifiers, which a tenant may choose to
// publish for awarded grants. Nothing is special category. Records are kept
// while the tenant is a customer; erasure anonymises a person in place
// (ADR 0017), and its rule arrives with the erasure ADR.

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

const keyAndActors = {
  tenant_id: internal,
  id: internal,
  created_at: internal,
  created_by: internal,
  updated_at: internal,
  updated_by: internal,
} as const;

export const party = {
  'party.party': {
    ...keyAndActors,
    kind: internal,
    status: internal,
    merged_into: internal,
    // When the database marked the party erased (ADR 0027), kept with it.
    erased_at: internal,
  },
  'party.organisation': {
    ...keyAndActors,
    kind: internal,
    name: internal,
    legal_form: internal,
    address_line1: personal,
    address_line2: personal,
    address_town: personal,
    address_postcode: personal,
    address_country_code: personal,
    website: internal,
    // Generated from name, so classified and retained as it is (ADR 0025).
    search_vector: internal,
  },
  'party.organisation_identifier': {
    ...keyAndActors,
    organisation_id: internal,
    scheme: internal,
    identifier: internal,
    verified_at: internal,
    verified_by: internal,
  },
  'party.person': {
    ...keyAndActors,
    kind: internal,
    given_name: personal,
    family_name: personal,
    email: personal,
    phone: personal,
    user_id: personal,
    // Generated from the names and email, so classified and retained as they
    // are, and emptied with them by erasure (ADR 0025).
    search_vector: personal,
  },
  'party.relationship': {
    ...keyAndActors,
    type: internal,
    subject_id: internal,
    subject_kind: internal,
    object_id: internal,
    object_kind: internal,
    starts_on: internal,
    ends_on: internal,
  },
  'party.consent': {
    tenant_id: internal,
    id: internal,
    person_id: personal,
    purpose: personal,
    channel: personal,
    state: personal,
    privacy_notice_version: personal,
    source: personal,
    recorded_at: personal,
    recorded_by: personal,
  },
  // That a person must not be contacted (ADR 0033). The one record erasure
  // keeps as it is (ADR 0027): it holds ids, codes, times and a keyed hash
  // of the address, no plain personal value, and is kept for the tenant's
  // lifetime, never under a tenant retention policy, while the person row
  // exists, so an erased person is never mailed again. The current-consent
  // view's columns are classified as these and party.consent's. The reason
  // is a fixed code, internal like auth.audit_event.reason: a personal
  // column's name is censored from every log line, and refusal reasons are
  // logged by that name.
  'party.suppression': {
    tenant_id: internal,
    id: internal,
    person_id: personal,
    channel: personal,
    purpose: personal,
    reason: internal,
    source: personal,
    address_hash: personal,
    hash_key_version: internal,
    recorded_at: internal,
    recorded_by: internal,
  },
  // An organisation as submitted (ADR 0017), classified like the columns it
  // copies. It is kept with the application that references it: today that
  // is the tenant's lifetime, as for grants.application, until retention
  // rules arrive (S11-102). Erasure clears its address as the
  // organisation's (ADR 0027).
  'party.organisation_snapshot': {
    tenant_id: internal,
    id: internal,
    organisation_id: internal,
    name: internal,
    legal_form: internal,
    address_line1: personal,
    address_line2: personal,
    address_town: personal,
    address_postcode: personal,
    address_country_code: personal,
    website: internal,
    identifiers: internal,
    taken_by: internal,
    taken_at: internal,
  },
  // One change to a party field (ADR 0025). The values are personal
  // whatever the field (ADR 0025, rule 5), and are kept as long as their
  // party; erasure clears them with their source column (ADR 0027).
  'party.value_history': {
    tenant_id: internal,
    id: internal,
    party_id: internal,
    party_kind: internal,
    field_id: internal,
    old_value: personal,
    new_value: personal,
    changed_by: internal,
    changed_at: internal,
  },
} satisfies ClassificationRegistry;

/**
 * Each table's path to the party its rows are about (ADR 0027). A person and
 * an organisation share their party's id.
 */
export const partySubjects: SubjectPathRegistry = {
  'party.party': { kind: 'party', column: 'id' },
  'party.organisation': { kind: 'party', column: 'id' },
  'party.organisation_identifier': { kind: 'party', column: 'organisation_id' },
  'party.organisation_snapshot': { kind: 'party', column: 'organisation_id' },
  'party.person': { kind: 'party', column: 'id' },
  'party.relationship': { kind: 'parties', columns: ['subject_id', 'object_id'] },
  'party.consent': { kind: 'party', column: 'person_id' },
  'party.suppression': { kind: 'party', column: 'person_id' },
  'party.value_history': { kind: 'party', column: 'party_id' },
};

const stored = ['hosting', 'backup'] as const;
const people = ['applicant', 'applicant_contact', 'staff_member', 'reviewer'] as const;

const record = (
  dataSubjects: ProcessingEntry['dataSubjects'],
  dataCategories: ProcessingEntry['dataCategories'],
): ProcessingEntry => ({
  purpose: 'party_records',
  legalBasis: 'legitimate_interests',
  processors: stored,
  dataSubjects,
  dataCategories,
});

export const partyProcessing: ProcessingRegistry<typeof party> = {
  'party.party': record(people, ['other']),
  // Its name is merged into the decision email.
  'party.organisation': {
    ...record(['applicant_contact'], ['contact']),
    processors: [...stored, 'email'],
  },
  'party.organisation_identifier': record([], []),
  'party.person': {
    ...record(people, ['identity', 'contact']),
    processors: [...stored, 'email'],
  },
  'party.relationship': record(people, ['other']),
  'party.consent': { ...record(people, ['other']), legalBasis: 'legal_obligation' },
  // Kept to honour an objection to direct marketing (UK GDPR Article 21(3),
  // PECR regulation 22); the address is kept only as its keyed hash.
  'party.suppression': {
    ...record(people, ['contact', 'other']),
    legalBasis: 'legal_obligation',
  },
  'party.organisation_snapshot': {
    ...record(['applicant_contact'], ['contact']),
    purpose: 'grant_applications',
    legalBasis: 'contract',
  },
  'party.value_history': record(people, ['identity', 'contact']),
};
